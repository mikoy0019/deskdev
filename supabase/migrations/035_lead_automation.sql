-- ============================================
-- DeskDev Studio — 035: Lead automation
--
-- The agency logic that has to run when nobody has the app open:
--
--   1. lead_sla_sweep()      every 5 minutes. A new lead nobody has answered
--                            by sla_due_at gets an 'sla_breached' activity and
--                            its owner is pinged; still unanswered after
--                            growth_escalate_minutes of business time, every
--                            admin is pinged. Each level fires once per lead.
--   2. lead_followups_due()  one digest per owner per day (follow-ups due and
--                            leads going cold), replacing the n8n lead-nudge
--                            email to a hardcoded address.
--   3. n8n: the 014 Sheets trigger only forwards pipeline events (no message
--      text, no SLA rows every 5 minutes), and a new trigger hands each new
--      real website lead to n8n's 'deskdev-lead-intake' workflow (auto-reply,
--      team email, Sheets), with only the lead id in the body.
--   4. lead_intake_attempts purge (7 days).
--
-- Notifications here are written by cron (no auth.uid()), so 030's guard
-- does not apply; they still use only 033's types (lead_sla, lead_followup).
-- Depends on 033 and 034. Re-runnable.
-- ============================================

-- ---------- 1. SLA sweep ----------
CREATE OR REPLACE FUNCTION public.lead_sla_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s       record;
  r       record;
  v_tz    text;
  v_n     integer := 0;
  v_title text;
BEGIN
  -- A slow sweep must not overlap the next one and double-ping.
  IF NOT pg_try_advisory_xact_lock(hashtext('public.lead_sla_sweep')) THEN
    RETURN 0;
  END IF;

  SELECT * INTO s FROM public.growth_settings();
  v_tz := coalesce(nullif(s.business_hours ->> 'tz', ''), 'UTC');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
  END;

  -- Level 1: the owner. A lead with no owner, or one who can no longer see
  -- leads (deactivated, growth access removed), goes to the admins.
  FOR r IN
    SELECT l.id, l.name, l.company, l.owner_id, l.sla_due_at
      FROM public.leads l
     WHERE l.stage = 'new'
       AND l.spam = false
       AND l.first_responded_at IS NULL
       AND l.sla_due_at IS NOT NULL
       AND l.sla_due_at <= now()
       AND NOT EXISTS (SELECT 1 FROM public.lead_activity a
                        WHERE a.lead_id = l.id AND a.action = 'sla_breached')
     ORDER BY l.sla_due_at
     LIMIT 500
  LOOP
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (r.id, NULL, 'sla_breached',
            jsonb_build_object('level', 'owner', 'owner_id', r.owner_id, 'sla_due_at', r.sla_due_at));

    v_title := left('No reply yet: ' || r.name, 300);
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    SELECT p.id, NULL, 'lead_sla', v_title,
           left(concat_ws(' · ', r.company,
                'first reply was due ' || to_char(r.sla_due_at AT TIME ZONE v_tz, 'Dy HH24:MI')), 1000),
           'lead', r.id
      FROM public.profiles p
     WHERE CASE WHEN public.user_has_perm(r.owner_id, 'growth', 'view')
                THEN p.id = r.owner_id
                ELSE p.role = 'admin' AND p.deactivated_at IS NULL END;
    v_n := v_n + 1;
  END LOOP;

  -- Level 2: every admin, once growth_escalate_minutes of business time have
  -- passed since the lead arrived. Needs level 1 first, so the owner always
  -- hears before the admins do.
  FOR r IN
    SELECT l.id, l.name, l.company, l.owner_id, l.created_at, o.full_name AS owner_name
      FROM public.leads l
      LEFT JOIN public.profiles o ON o.id = l.owner_id
     WHERE l.stage = 'new'
       AND l.spam = false
       AND l.first_responded_at IS NULL
       AND l.sla_due_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.lead_activity a
                    WHERE a.lead_id = l.id AND a.action = 'sla_breached'
                      AND a.detail ->> 'level' = 'owner')
       AND NOT EXISTS (SELECT 1 FROM public.lead_activity a
                        WHERE a.lead_id = l.id AND a.action = 'sla_breached'
                          AND a.detail ->> 'level' = 'admins')
       AND public.add_business_minutes(l.created_at, s.escalate_minutes, s.business_hours) <= now()
     ORDER BY l.created_at
     LIMIT 500
  LOOP
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (r.id, NULL, 'sla_breached',
            jsonb_build_object('level', 'admins', 'owner_id', r.owner_id,
                               'escalate_minutes', s.escalate_minutes));

    v_title := left('Escalated: ' || r.name || ' still has no reply', 300);
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    SELECT p.id, NULL, 'lead_sla', v_title,
           left(concat_ws(' · ', r.company, 'owner ' || coalesce(r.owner_name, 'unassigned'),
                'arrived ' || to_char(r.created_at AT TIME ZONE v_tz, 'Dy HH24:MI')), 1000),
           'lead', r.id
      FROM public.profiles p
     WHERE p.deactivated_at IS NULL
       AND p.role = 'admin';
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_sla_sweep() FROM PUBLIC, anon, authenticated;

-- ---------- 2. Daily follow-up digest ----------
-- Runs hourly and sends once per recipient per LOCAL day, after 08:00 in the
-- business-hours timezone. That way changing the timezone in Settings →
-- Growth moves the digest with it, with no cron edit.
-- A lead counts for its owner; when the owner cannot see leads (none,
-- deactivated, access removed), for every admin.
-- "Due": follow_up on or before today. "Going cold": no touch for
-- growth_stale_days (and not already counted as due). Open, real leads only.
CREATE OR REPLACE FUNCTION public.lead_followups_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s         record;
  r         record;
  v_tz      text;
  v_local   timestamp;
  v_today   date;
  v_since   timestamptz;
  v_n       integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.lead_followups_due')) THEN
    RETURN 0;
  END IF;

  SELECT * INTO s FROM public.growth_settings();
  v_tz := coalesce(nullif(s.business_hours ->> 'tz', ''), 'UTC');
  BEGIN
    v_local := now() AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
    v_local := now() AT TIME ZONE 'UTC';
  END;
  IF extract(hour FROM v_local) < 8 THEN
    RETURN 0;
  END IF;
  v_today := v_local::date;
  v_since := v_today::timestamp AT TIME ZONE v_tz;

  FOR r IN
    WITH open_leads AS (
      SELECT l.id, l.name, l.owner_id, l.follow_up,
             (l.follow_up IS NOT NULL AND l.follow_up <= v_today) AS due,
             (coalesce(l.last_touch_at, l.created_at) < now() - make_interval(days => s.stale_days)) AS cold,
             coalesce(l.follow_up, '9999-12-31'::date) AS sort_key
        FROM public.leads l
       WHERE l.stage IN ('new', 'contacted', 'proposal')
         AND l.spam = false
    ),
    flagged AS (
      SELECT * FROM open_leads WHERE due OR cold
    ),
    routed AS (
      SELECT f.*, p.id AS recipient
        FROM flagged f
        JOIN public.profiles p
          ON CASE WHEN public.user_has_perm(f.owner_id, 'growth', 'view')
                  THEN p.id = f.owner_id
                  ELSE p.role = 'admin' AND p.deactivated_at IS NULL END
    )
    SELECT recipient,
           count(*) FILTER (WHERE due)              AS n_due,
           count(*) FILTER (WHERE cold AND NOT due) AS n_cold,
           (array_agg(name ORDER BY due DESC, sort_key, name) FILTER (WHERE due))[1:3]              AS due_names,
           (array_agg(name ORDER BY name) FILTER (WHERE cold AND NOT due))[1:3]                     AS cold_names,
           (array_agg(id))[1] AS first_id,
           count(*) AS n_all
      FROM routed
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = routed.recipient
          AND n.type = 'lead_followup'
          AND n.created_at >= v_since)
     GROUP BY recipient
  LOOP
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    VALUES (
      r.recipient, NULL, 'lead_followup',
      CASE WHEN r.n_all = 1 THEN '1 lead needs a follow-up today'
           ELSE r.n_all || ' leads need a follow-up today' END,
      left(concat_ws(' · ',
        CASE WHEN r.n_due > 0 THEN 'Due: ' || array_to_string(r.due_names, ', ')
             || CASE WHEN r.n_due > 3 THEN ' +' || (r.n_due - 3) ELSE '' END END,
        CASE WHEN r.n_cold > 0 THEN 'Going cold: ' || array_to_string(r.cold_names, ', ')
             || CASE WHEN r.n_cold > 3 THEN ' +' || (r.n_cold - 3) ELSE '' END END), 1000),
      'lead',
      CASE WHEN r.n_all = 1 THEN r.first_id END
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_followups_due() FROM PUBLIC, anon, authenticated;

-- ---------- 3. n8n side effects ----------
-- 3a. Sheets log: pipeline events only. 014 forwarded every lead_activity
-- row, which would now include each prospect's message (submitted,
-- resubmitted, email_*), staff notes and an sla_breached row per lead. Same
-- trigger name and function, narrowed by action.
DROP TRIGGER IF EXISTS n8n_log_lead_activity ON public.lead_activity;
CREATE TRIGGER n8n_log_lead_activity
  AFTER INSERT ON public.lead_activity
  FOR EACH ROW
  WHEN (NEW.action IN ('created', 'stage_changed', 'contacted', 'won', 'lost', 'assigned',
                       'proposal_sent', 'meeting_booked', 'converted'))
  EXECUTE FUNCTION public.notify_n8n_log();

-- 3b. New website lead → n8n 'deskdev-lead-intake' (auto-reply if enabled,
-- team email, Sheets). The body is only the id; the workflow re-reads the
-- lead with the service role, so no prospect data sits in net._http_response.
-- Fires for rows that came through intake (last_submitted_at set) and are
-- real (spam = false). Imported history (form 'import') never triggers an
-- auto-reply. A failure here is a WARNING: the lead itself must commit.
CREATE OR REPLACE FUNCTION public.notify_n8n_lead_intake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.n8n_post('deskdev-lead-intake', jsonb_build_object('lead_id', NEW.id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'notify_n8n_lead_intake(%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_n8n_lead_intake() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS n8n_lead_intake ON public.leads;
CREATE TRIGGER n8n_lead_intake
  AFTER INSERT ON public.leads
  FOR EACH ROW
  WHEN (NEW.spam = false AND NEW.last_submitted_at IS NOT NULL AND NEW.form <> 'import')
  EXECUTE FUNCTION public.notify_n8n_lead_intake();

-- ---------- 4. Throttle ledger retention ----------
-- The throttle looks back one day at most; a week keeps enough to debug a
-- flood.
CREATE OR REPLACE FUNCTION public.purge_lead_intake_attempts()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM public.lead_intake_attempts WHERE at < now() - interval '7 days' RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE ALL ON FUNCTION public.purge_lead_intake_attempts() FROM PUBLIC, anon, authenticated;

-- ---------- 5. Schedules ----------
-- 024 enabled pg_cron; IF NOT EXISTS keeps this safe on a project where it did not run.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lead-sla-sweep') THEN
    PERFORM cron.unschedule('lead-sla-sweep');
  END IF;
  PERFORM cron.schedule('lead-sla-sweep', '*/5 * * * *',
    $cron$ SELECT public.lead_sla_sweep() $cron$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lead-followups-due') THEN
    PERFORM cron.unschedule('lead-followups-due');
  END IF;
  -- Hourly; the function itself sends once per local day after 08:00.
  PERFORM cron.schedule('lead-followups-due', '7 * * * *',
    $cron$ SELECT public.lead_followups_due() $cron$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-lead-intake-attempts') THEN
    PERFORM cron.unschedule('purge-lead-intake-attempts');
  END IF;
  PERFORM cron.schedule('purge-lead-intake-attempts', '25 3 * * *',
    $cron$ SELECT public.purge_lead_intake_attempts() $cron$);
END $$;
