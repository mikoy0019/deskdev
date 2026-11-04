-- ============================================
-- DeskDev Studio — 034: Website lead intake
--
-- The database becomes the system of record for website enquiries. Until now
-- the contact form forwarded to an n8n webhook that answered 200 before it
-- inserted anything, so a sleeping or broken n8n lost the lead silently.
-- Now the site Worker calls ONE secret-gated RPC that writes the lead in a
-- single transaction; email, Sheets and auto-replies are side effects that
-- 035 hands to n8n afterwards.
--
--   1. leads: intake columns (email_norm, services, budget band, timeline,
--      message, attribution, consent, score, SLA, spam, existing client,
--      submission count)
--   2. lead_activity: the full action vocabulary, including the Google
--      actions (email_received, email_sent, meeting_booked) so a later
--      migration does not have to widen the CHECK again
--   3. lead_intake_attempts: the throttle ledger
--   4. Pure helpers: lead_budget_band(), lead_timeline(), lead_services(),
--      lead_clean_attribution(), lead_score(), add_business_minutes()
--   5. leads_score trigger: score/breakdown/hot computed by the server
--   6. pick_lead_owner(): round-robin over the Growth owner pool
--   7. lead_activity_stops_sla trigger: a logged reply stops the SLA clock
--      however it was logged (app, n8n, Gmail)
--   8. intake_site_lead(p_secret, p_payload): the ONLY anon entry point
--
-- Depends on 032 (profiles.deactivated_at) and 033 (workspace_settings,
-- user_has_perm(), the lead_* notification types). Apply in ledger order, by hand:
--   supabase db query --linked -f supabase/migrations/034_lead_intake.sql
-- The secret the RPC checks lives in Supabase Vault (SQL editor, as postgres):
--   SELECT vault.create_secret('<long random value>', 'lead_intake_secret');
-- The SAME value is the site Worker secret LEAD_INTAKE_SECRET. Until the Vault
-- row exists the RPC refuses every call (fails closed).
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.
-- ============================================

-- ---------- 0. Ledger order guard ----------
-- A clear message beats a function that fails at the first real enquiry.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'deactivated_at') THEN
    RAISE EXCEPTION '034 needs 032_account_lifecycle.sql (profiles.deactivated_at) applied first';
  END IF;
  IF to_regclass('public.workspace_settings') IS NULL THEN
    RAISE EXCEPTION '034 needs 033_notification_vocabulary_settings.sql (workspace_settings) applied first';
  END IF;
END $$;

-- ---------- 1. Lead columns ----------
-- phone and company exist since 012; IF NOT EXISTS makes listing them harmless.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email_norm         text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  ADD COLUMN IF NOT EXISTS phone              text,
  ADD COLUMN IF NOT EXISTS company            text,
  ADD COLUMN IF NOT EXISTS services           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS budget_band        text,
  ADD COLUMN IF NOT EXISTS timeline           text,
  ADD COLUMN IF NOT EXISTS message            text,
  ADD COLUMN IF NOT EXISTS form               text NOT NULL DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS attribution        jsonb,
  ADD COLUMN IF NOT EXISTS consent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS score              integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_breakdown    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sla_due_at         timestamptz,
  ADD COLUMN IF NOT EXISTS spam               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spam_reason        text,
  ADD COLUMN IF NOT EXISTS ip_hash            text,
  ADD COLUMN IF NOT EXISTS existing_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_count   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_submitted_at  timestamptz;

-- Dedupe and existing-client lookups go by the normalised address.
CREATE INDEX IF NOT EXISTS leads_email_norm_idx ON public.leads (email_norm);
-- The SLA sweep only ever looks at open, unanswered, real leads.
CREATE INDEX IF NOT EXISTS leads_sla_open_idx
  ON public.leads (sla_due_at)
  WHERE stage = 'new' AND spam = false AND first_responded_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_spam_idx ON public.leads (spam) WHERE spam;
CREATE INDEX IF NOT EXISTS leads_follow_up_idx ON public.leads (follow_up) WHERE follow_up IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_owner_created_idx ON public.leads (owner_id, created_at);

-- Bounds the server also enforces on intake, so a staff edit or an n8n write
-- cannot store what the form could not.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_form_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_form_check
      CHECK (form ~ '^[a-z0-9_-]{1,32}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_intake_lengths_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_intake_lengths_check CHECK (
      (budget_band IS NULL OR char_length(budget_band) <= 40)
      AND (timeline IS NULL OR char_length(timeline) <= 40)
      AND (message IS NULL OR char_length(message) <= 5000)
      AND (spam_reason IS NULL OR char_length(spam_reason) <= 200)
      AND (ip_hash IS NULL OR char_length(ip_hash) <= 128)
      AND cardinality(services) <= 8
      AND submission_count >= 1
      AND score BETWEEN 0 AND 100
    );
  END IF;
END $$;

-- ---------- 2. lead_activity: the whole vocabulary ----------
-- 014 allowed six actions. Every action any part of the plan logs is listed
-- here once (intake, triage, automation, conversion and the Google-backed
-- ones), so the CHECK is not widened migration by migration.
ALTER TABLE public.lead_activity DROP CONSTRAINT IF EXISTS lead_activity_action_check;
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_action_check
  CHECK (action IN (
    'created', 'stage_changed', 'contacted', 'note', 'won', 'lost',
    'submitted', 'resubmitted', 'assigned', 'sla_breached', 'spam_marked',
    'not_spam', 'proposal_sent', 'auto_reply_sent', 'email_received',
    'email_sent', 'meeting_booked', 'converted', 'followup_set',
    'booking_link_sent', 'call_logged'
  ));

-- ---------- 3. Throttle ledger ----------
-- One row per intake call that got past the secret AND the throttle. A
-- merged submission writes no new lead row, so the leads table alone cannot
-- count attempts. Refused calls are not written: if they counted, one caller
-- could keep the window full and shut the form for everyone, and a flood of
-- refusals could grow the table without bound (the route logs them instead).
-- The 'throttled' status stays allowed for rows written before that rule.
-- RLS on: admins may read it (debugging a flood); nobody writes it from a
-- client. 035 purges rows after 7 days.
CREATE TABLE IF NOT EXISTS public.lead_intake_attempts (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  ip_hash    text,
  email_norm text,
  lead_id    uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  status     text NOT NULL CHECK (status IN ('created', 'merged', 'quarantined', 'throttled'))
);

CREATE INDEX IF NOT EXISTS lead_intake_attempts_ip_idx ON public.lead_intake_attempts (ip_hash, at);
CREATE INDEX IF NOT EXISTS lead_intake_attempts_email_idx ON public.lead_intake_attempts (email_norm, at);
CREATE INDEX IF NOT EXISTS lead_intake_attempts_at_idx ON public.lead_intake_attempts (at);

ALTER TABLE public.lead_intake_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_intake_attempts_select_admin" ON public.lead_intake_attempts;
CREATE POLICY "lead_intake_attempts_select_admin"
  ON public.lead_intake_attempts FOR SELECT
  TO authenticated USING (public.is_admin());

REVOKE ALL ON public.lead_intake_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_intake_attempts TO authenticated;
REVOKE ALL ON SEQUENCE public.lead_intake_attempts_id_seq FROM PUBLIC, anon, authenticated;

-- Supabase's default privileges hand anon ALL on every table. RLS already
-- returns nothing (no anon policy exists), but the only public door to leads
-- is intake_site_lead, so the grants go too.
REVOKE ALL ON public.leads FROM anon;
REVOKE ALL ON public.lead_activity FROM anon;

-- ---------- 4. Pure helpers ----------
-- Budget bands. The real bands wait on the owner (Q11), and two key sets are
-- in play: the one below the current site labels map to, and the one the
-- DeskDev screens offer (lib/leads.ts BUDGET_BANDS: 1k_3k, 3k_7k, 7k_15k,
-- 15k_plus, unsure). Both are accepted and scored, so whichever the new form
-- sends is understood; when Q11 is answered one set is dropped here and in
-- lead_score together. The current form's labels ("$2.5K — $5K") are mapped,
-- so the route can forward a label or a key. 'unsure' is kept (the inbox
-- shows it) and scores 0. Anything else is kept as typed (lower-cased, 40
-- chars) and scores 0.
CREATE OR REPLACE FUNCTION public.lead_budget_band(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH t AS (SELECT lower(btrim(coalesce(p, ''))) AS raw),
       s AS (SELECT raw, regexp_replace(raw, '[^0-9a-z.+<]', '', 'g') AS k FROM t)
  SELECT CASE
    WHEN raw = '' OR raw = 'not selected' THEN NULL
    WHEN raw IN ('under_1k', '1k_2_5k', '2_5k_5k', '5k_10k', '10k_25k', '25k_plus',
                 '1k_3k', '3k_7k', '7k_15k', '15k_plus', 'unsure') THEN raw
    WHEN raw IN ('not sure', 'not sure yet', 'unsure yet', 'unknown') THEN 'unsure'
    WHEN k IN ('<1k', 'under1k', '01k', '0k1k')              THEN 'under_1k'
    WHEN k IN ('1k2.5k', '1k2500', '10002500')                THEN '1k_2_5k'
    WHEN k IN ('2.5k5k', '25005000', '2.5k5000')              THEN '2_5k_5k'
    WHEN k IN ('5k10k', '500010000')                          THEN '5k_10k'
    WHEN k IN ('10k25k', '1000025000', '10k+', '10000+', '10kplus') THEN '10k_25k'
    WHEN k IN ('25k+', '25000+', '25kplus', 'over25k', '25k') THEN '25k_plus'
    WHEN k IN ('1k3k', '10003000')                            THEN '1k_3k'
    WHEN k IN ('3k7k', '30007000')                            THEN '3k_7k'
    WHEN k IN ('7k15k', '700015000')                          THEN '7k_15k'
    WHEN k IN ('15k+', '15000+', '15kplus', 'over15k')        THEN '15k_plus'
    ELSE left(raw, 40)
  END
  FROM s;
$$;

-- Timeline keys: asap, 1_3_months, 3_6_months, 6_plus_months, exploring.
CREATE OR REPLACE FUNCTION public.lead_timeline(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH t AS (SELECT lower(btrim(coalesce(p, ''))) AS raw),
       s AS (SELECT raw, regexp_replace(raw, '[^0-9a-z+]', '', 'g') AS k FROM t)
  SELECT CASE
    WHEN raw = '' OR raw = 'not selected' THEN NULL
    WHEN raw IN ('asap', '1_3_months', '3_6_months', '6_plus_months', 'exploring') THEN raw
    WHEN k ~ '^(asap|now|immediately|urgent|rightaway|thismonth|within(a|1)month)' THEN 'asap'
    WHEN k ~ '^1(to)?3months?'                       THEN '1_3_months'
    WHEN k ~ '^3(to)?6months?'                       THEN '3_6_months'
    WHEN k ~ '^(6\+|6plus|6months?\+|over6|later)'   THEN '6_plus_months'
    WHEN k ~ '^(exploring|justlooking|notsure|unsure|research)' THEN 'exploring'
    ELSE left(raw, 40)
  END
  FROM s;
$$;

-- Services: lower-case slugs, de-duplicated, at most 8. Accepts a JSON array
-- or a comma-separated string. The positioning's four offers have canonical
-- keys (lib/leads.ts LEAD_SERVICES): website, app, automation, developer.
-- The route forwards the form's LABELS ("Automation & AI", "App / dashboard",
-- today's "Dashboard", "AI Operations"), so labels are folded onto those keys
-- here; convert_lead's starter tasks and the reports group by them. Anything
-- else is kept as its slug.
CREATE OR REPLACE FUNCTION public.lead_services(p jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH raw AS (
    SELECT e.v, e.ord
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(v, ord)
    UNION ALL
    SELECT s.v, s.ord
      FROM regexp_split_to_table(CASE WHEN jsonb_typeof(p) = 'string' THEN p #>> '{}' ELSE '' END, ',')
           WITH ORDINALITY AS s(v, ord)
  ),
  slugged AS (
    SELECT left(trim(both '_' FROM regexp_replace(lower(btrim(v)), '[^a-z0-9]+', '_', 'g')), 40) AS s, ord
      FROM raw
  ),
  canon AS (
    SELECT CASE
             WHEN s ~ '(^|_)(automation|automations|automate|ai)(_|$)'               THEN 'automation'
             WHEN s ~ '(^|_)(developer|developers|dev|dedicated)(_|$)'               THEN 'developer'
             WHEN s ~ '(^|_)(app|apps|web_app|dashboard|dashboards|portal|saas)(_|$)' THEN 'app'
             WHEN s ~ '(^|_)(website|websites|site|web_design|landing)(_|$)'         THEN 'website'
             ELSE s
           END AS slug,
           ord
      FROM slugged
  ),
  slugs AS (
    SELECT slug, min(ord) AS ord
      FROM canon
     GROUP BY 1
  )
  SELECT coalesce(array_agg(slug ORDER BY ord), '{}')
    FROM (SELECT slug, ord FROM slugs WHERE slug <> '' ORDER BY ord LIMIT 8) x;
$$;

-- Attribution: first touch at the top level (what reports group by, and the
-- keys 039's retention scrub keeps), last touch under "last". Only known keys,
-- strings only, 300 chars each, so the column cannot become a dumping ground.
CREATE OR REPLACE FUNCTION public.lead_clean_attribution(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH keys(k) AS (
    VALUES ('utm_source'), ('utm_medium'), ('utm_campaign'), ('utm_term'), ('utm_content'),
           ('referrer'), ('landing_page'), ('gclid'), ('at')
  ),
  -- site/src/lib/attribution.ts calls the landing page 'landing'; it is
  -- stored under the one name, landing_page.
  raw AS (
    SELECT CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END AS top,
           CASE WHEN jsonb_typeof(p -> 'first') = 'object' THEN p -> 'first' END AS first,
           CASE WHEN jsonb_typeof(p -> 'last') = 'object' THEN p -> 'last' END AS last
  ),
  src AS (
    SELECT CASE WHEN top ? 'landing' AND NOT top ? 'landing_page'
                THEN top || jsonb_build_object('landing_page', top -> 'landing') ELSE top END AS top,
           CASE WHEN first ? 'landing' AND NOT first ? 'landing_page'
                THEN first || jsonb_build_object('landing_page', first -> 'landing') ELSE first END AS first,
           CASE WHEN last ? 'landing' AND NOT last ? 'landing_page'
                THEN last || jsonb_build_object('landing_page', last -> 'landing') ELSE last END AS last
      FROM raw
  ),
  first_touch AS (
    SELECT coalesce(jsonb_object_agg(k.k, left(coalesce(src.first, src.top) ->> k.k, 300))
                      FILTER (WHERE jsonb_typeof(coalesce(src.first, src.top) -> k.k) = 'string'
                                AND btrim(coalesce(src.first, src.top) ->> k.k) <> ''),
                    '{}'::jsonb) AS j
      FROM keys k, src
  ),
  last_touch AS (
    SELECT coalesce(jsonb_object_agg(k.k, left(src.last ->> k.k, 300))
                      FILTER (WHERE jsonb_typeof(src.last -> k.k) = 'string'
                                AND btrim(src.last ->> k.k) <> ''),
                    '{}'::jsonb) AS j
      FROM keys k, src
  )
  SELECT nullif(
           first_touch.j || CASE WHEN last_touch.j = '{}'::jsonb THEN '{}'::jsonb
                                 ELSE jsonb_build_object('last', last_touch.j) END,
           '{}'::jsonb)
    FROM first_touch, last_touch;
$$;

-- Lead scoring: transparent rules, no AI (PLAN Topic A).
--   budget band 0–40 · timeline asap +20, 1–3 months +12 · business email
--   domain +10 · company +5 · phone +5 · message over 200 chars +5 · repeat
--   submission +10 · existing client +15 · two or more services +5
-- Capped at 100; 60 or more is "hot". Input keys: budget_band, timeline,
-- email, company, phone, message, submission_count, existing_client
-- (boolean), services (array). Returns {score, breakdown} where breakdown
-- lists only the rules that scored, so the UI can explain the number. Rule
-- keys (shared with lib/leads.ts scoreLead): budget, timeline, business_email,
-- company, phone, detailed_message, repeat_submission, existing_client,
-- multiple_services.
CREATE OR REPLACE FUNCTION public.lead_score(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  p        jsonb := CASE WHEN jsonb_typeof(payload) = 'object' THEN payload ELSE '{}'::jsonb END;
  b        jsonb := '{}'::jsonb;
  v_budget text := public.lead_budget_band(p ->> 'budget_band');
  v_time   text := public.lead_timeline(p ->> 'timeline');
  v_domain text := lower(split_part(btrim(coalesce(p ->> 'email', '')), '@', 2));
  v_total  integer;
BEGIN
  b := b || jsonb_build_object('budget', CASE v_budget
         WHEN '25k_plus' THEN 40 WHEN '10k_25k' THEN 32 WHEN '5k_10k' THEN 24
         WHEN '2_5k_5k' THEN 16 WHEN '1k_2_5k' THEN 8
         WHEN '15k_plus' THEN 40 WHEN '7k_15k' THEN 30 WHEN '3k_7k' THEN 20
         WHEN '1k_3k' THEN 10 ELSE 0 END);
  b := b || jsonb_build_object('timeline', CASE v_time
         WHEN 'asap' THEN 20 WHEN '1_3_months' THEN 12 ELSE 0 END);
  -- Free-mail providers say nothing about the buyer; a company domain does.
  b := b || jsonb_build_object('business_email', CASE
         WHEN v_domain = '' OR v_domain !~ '\.' THEN 0
         WHEN v_domain ~ '^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|zoho|tutanota|fastmail|hey|qq|163|126|rocketmail)\.'
           OR v_domain ~ '\.(gmail|yahoo|hotmail|outlook)\.' THEN 0
         ELSE 10 END);
  b := b || jsonb_build_object('company', CASE WHEN btrim(coalesce(p ->> 'company', '')) <> '' THEN 5 ELSE 0 END);
  b := b || jsonb_build_object('phone', CASE WHEN btrim(coalesce(p ->> 'phone', '')) <> '' THEN 5 ELSE 0 END);
  b := b || jsonb_build_object('detailed_message', CASE WHEN char_length(btrim(coalesce(p ->> 'message', ''))) > 200 THEN 5 ELSE 0 END);
  b := b || jsonb_build_object('repeat_submission', CASE
         WHEN coalesce(nullif(p ->> 'submission_count', ''), '1') ~ '^[0-9]{1,9}$'
              AND (p ->> 'submission_count')::integer > 1 THEN 10 ELSE 0 END);
  b := b || jsonb_build_object('existing_client', CASE
         WHEN jsonb_typeof(p -> 'existing_client') = 'boolean' AND (p ->> 'existing_client')::boolean THEN 15 ELSE 0 END);
  b := b || jsonb_build_object('multiple_services', CASE
         WHEN jsonb_typeof(p -> 'services') = 'array' AND jsonb_array_length(p -> 'services') >= 2 THEN 5 ELSE 0 END);

  SELECT coalesce(sum(value::integer), 0) INTO v_total FROM jsonb_each_text(b);
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO b
    FROM jsonb_each(b) WHERE value::text <> '0';
  RETURN jsonb_build_object('score', least(v_total, 100), 'breakdown', b);
END;
$$;

-- add_business_minutes(ts, minutes, hours): the moment `minutes` of business
-- time have passed after ts. hours = {"tz","days":[ISO 1=Mon … 7=Sun],
-- "start":"HH:MM","end":"HH:MM"} (workspace_settings.growth_business_hours).
--
-- DST-safe by construction: each day's window is built from the LOCAL date
-- and wall-clock times and converted to an absolute instant with AT TIME ZONE,
-- and minutes are then counted as real elapsed time between instants. So a
-- Friday 17:30 lead with a 60-minute SLA is due Monday 09:30 local whether or
-- not the clocks moved over the weekend, and a window that contains the
-- change itself counts the hour that really passed.
-- Bad or missing hours (unknown tz, end <= start, no days) fall back to plain
-- elapsed minutes rather than raising: this runs inside the intake RPC.
CREATE OR REPLACE FUNCTION public.add_business_minutes(ts timestamptz, minutes integer, hours jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz    text := coalesce(nullif(btrim(hours ->> 'tz'), ''), 'UTC');
  v_days  integer[];
  v_start time;
  v_end   time;
  v_left  interval;
  v_cur   timestamptz := ts;
  v_day   date;
  v_open  timestamptz;
  v_close timestamptz;
  i       integer := 0;
BEGIN
  IF ts IS NULL THEN
    RETURN NULL;
  END IF;
  IF minutes IS NULL OR minutes <= 0 THEN
    RETURN ts;
  END IF;
  v_left := make_interval(mins => minutes);

  BEGIN
    v_start := (hours ->> 'start')::time;
    v_end   := (hours ->> 'end')::time;
    SELECT array_agg(DISTINCT d::integer) INTO v_days
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(hours -> 'days') = 'array' THEN hours -> 'days' ELSE '[]'::jsonb END) AS d
     WHERE d ~ '^[1-7]$';
    v_day := (ts AT TIME ZONE v_tz)::date;   -- raises on an unknown zone
  EXCEPTION WHEN others THEN
    RETURN ts + v_left;
  END;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start OR v_days IS NULL THEN
    RETURN ts + v_left;
  END IF;

  LOOP
    i := i + 1;
    -- 20 years of calendar days: unreachable for any sane SLA, but a loop in
    -- the intake path must have a floor.
    IF i > 7400 THEN
      RETURN ts + make_interval(mins => minutes);
    END IF;
    IF extract(isodow FROM v_day)::integer = ANY (v_days) THEN
      v_open  := (v_day + v_start) AT TIME ZONE v_tz;
      v_close := (v_day + v_end) AT TIME ZONE v_tz;
      IF v_cur < v_open THEN
        v_cur := v_open;
      END IF;
      IF v_cur < v_close THEN
        IF v_cur + v_left <= v_close THEN
          RETURN v_cur + v_left;
        END IF;
        v_left := v_left - (v_close - v_cur);
        v_cur := v_close;
      END IF;
    END IF;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

-- Growth settings with the 033 defaults filled in, so a missing or partial
-- row never breaks intake or the sweeps.
CREATE OR REPLACE FUNCTION public.growth_settings()
RETURNS TABLE (
  sla_minutes      integer,
  escalate_minutes integer,
  business_hours   jsonb,
  owner_pool       uuid[],
  notify_all       boolean,
  stale_days       integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(w.growth_sla_minutes, 60),
         coalesce(w.growth_escalate_minutes, 240),
         coalesce(w.growth_business_hours,
                  '{"tz":"Asia/Manila","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb),
         coalesce(w.growth_owner_pool, '{}'::uuid[]),
         coalesce(w.growth_notify_all, true),
         coalesce(w.growth_stale_days, 14)
    FROM (SELECT 1) one
    LEFT JOIN public.workspace_settings w ON true
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lead_budget_band(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_timeline(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_services(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_clean_attribution(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_score(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_business_minutes(timestamptz, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_settings() FROM PUBLIC, anon, authenticated;
-- Pure functions: the app may preview a score or an SLA due time with them.
-- service_role is named explicitly: the score trigger (not SECURITY DEFINER)
-- calls lead_score() as whoever writes the lead, and n8n writes as the
-- service role; relying on Supabase's default grants would be implicit.
GRANT EXECUTE ON FUNCTION public.lead_budget_band(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_timeline(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_services(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_clean_attribution(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_score(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_business_minutes(timestamptz, integer, jsonb) TO authenticated, service_role;

-- ---------- 5. Score is computed by the server ----------
-- Every lead gets a score, whether it came from the form, the app or n8n.
-- Only OPEN leads are re-scored on edit: a won or lost lead keeps the score
-- it closed with (the reports compare scores with outcomes, and 039's
-- retention scrub of a lost lead must not change its number). `hot` is only
-- ever switched ON by the score; staff can still switch it either way.
CREATE OR REPLACE FUNCTION public.leads_apply_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.stage NOT IN ('new', 'contacted', 'proposal') THEN
    RETURN NEW;
  END IF;
  r := public.lead_score(jsonb_build_object(
    'budget_band',      NEW.budget_band,
    'timeline',         NEW.timeline,
    'email',            NEW.email,
    'company',          NEW.company,
    'phone',            NEW.phone,
    'message',          NEW.message,
    'submission_count', NEW.submission_count,
    'existing_client',  NEW.existing_client_id IS NOT NULL,
    'services',         to_jsonb(coalesce(NEW.services, '{}'::text[]))
  ));
  NEW.score := (r ->> 'score')::integer;
  NEW.score_breakdown := r -> 'breakdown';
  IF NOT NEW.spam AND NEW.score >= 60
     AND (TG_OP = 'INSERT' OR OLD.score < 60) THEN
    NEW.hot := true;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.leads_apply_score() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leads_score ON public.leads;
CREATE TRIGGER leads_score
  BEFORE INSERT OR UPDATE OF budget_band, timeline, email, company, phone, message,
                             submission_count, existing_client_id, services, spam
  ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_apply_score();

-- Score the open leads that predate this file, once (an unscored row has an
-- empty breakdown). updated_at is left alone: it is "last edited by a
-- person" for the app and the clock 039's retention reads, and a migration
-- is neither. hot is not touched; staff set it on those rows.
ALTER TABLE public.leads DISABLE TRIGGER leads_set_updated_at;
UPDATE public.leads l
   SET score           = (s.r ->> 'score')::integer,
       score_breakdown = s.r -> 'breakdown'
  FROM (
    SELECT id, public.lead_score(jsonb_build_object(
             'budget_band', budget_band, 'timeline', timeline, 'email', email,
             'company', company, 'phone', phone, 'message', message,
             'submission_count', submission_count,
             'existing_client', existing_client_id IS NOT NULL,
             'services', to_jsonb(coalesce(services, '{}'::text[])))) AS r
      FROM public.leads
     WHERE stage IN ('new', 'contacted', 'proposal')
       AND score_breakdown = '{}'::jsonb
  ) s
 WHERE l.id = s.id
   AND s.r -> 'breakdown' <> '{}'::jsonb;
ALTER TABLE public.leads ENABLE TRIGGER leads_set_updated_at;

-- ---------- 6. Owner round-robin ----------
-- The next owner from workspace_settings.growth_owner_pool: the pool member
-- who can work leads (user_has_perm growth:edit, which excludes deactivated
-- people, 033) and whose most recent real lead
-- is oldest, so the pool rotates without a stored cursor and a member who
-- joins the pool goes next. Ties follow pool order. An empty or all-inactive
-- pool falls back to the longest-standing active admin (the owner, Q6).
-- The advisory lock serialises two intakes arriving together, so they do not
-- both land on the same person.
CREATE OR REPLACE FUNCTION public.pick_lead_owner()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pool  uuid[];
  v_owner uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.pick_lead_owner'));
  SELECT owner_pool INTO v_pool FROM public.growth_settings();

  SELECT p.id INTO v_owner
    FROM unnest(coalesce(v_pool, '{}'::uuid[])) WITH ORDINALITY AS pool(id, ord)
    JOIN public.profiles p ON p.id = pool.id
   WHERE public.user_has_perm(p.id, 'growth', 'edit')
   ORDER BY (SELECT max(l.created_at) FROM public.leads l
              WHERE l.owner_id = p.id AND l.spam = false) ASC NULLS FIRST,
            pool.ord
   LIMIT 1;

  IF v_owner IS NULL THEN
    SELECT p.id INTO v_owner
      FROM public.profiles p
     WHERE p.role = 'admin' AND p.deactivated_at IS NULL
     ORDER BY p.created_at, p.id
     LIMIT 1;
  END IF;
  RETURN v_owner;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_lead_owner() FROM PUBLIC, anon, authenticated;

-- ---------- 7. A logged reply stops the SLA clock ----------
-- The app sets first_responded_at itself, but replies also arrive as rows
-- written by n8n (email_sent from the shared inbox) or by later Google
-- integrations. Doing it here means the SLA sweep never escalates a lead
-- that was answered outside the app. An auto-reply is not a response.
CREATE OR REPLACE FUNCTION public.lead_activity_stops_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.leads
     SET first_responded_at = coalesce(first_responded_at, NEW.created_at),
         last_touch_at      = greatest(coalesce(last_touch_at, NEW.created_at), NEW.created_at)
   WHERE id = NEW.lead_id
     AND (first_responded_at IS NULL OR last_touch_at IS NULL OR last_touch_at < NEW.created_at);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_activity_stops_sla() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lead_activity_stops_sla ON public.lead_activity;
CREATE TRIGGER lead_activity_stops_sla
  AFTER INSERT ON public.lead_activity
  FOR EACH ROW
  WHEN (NEW.action IN ('contacted', 'email_sent', 'call_logged', 'meeting_booked',
                       'booking_link_sent', 'proposal_sent'))
  EXECUTE FUNCTION public.lead_activity_stops_sla();

-- ---------- 8. intake_site_lead ----------
-- Called by the site Worker (/api/contact) with the anon key plus
-- LEAD_INTAKE_SECRET. The Worker holds no service-role key (plan rule 5), so
-- this function is the whole of its write access, and everything it stores
-- is validated and truncated here, not trusted from the route.
--
-- p_payload keys (everything else is ignored):
--   name          required, 120 chars
--   email         required, 254 chars, must look like an address
--   phone         optional, 40 chars
--   company       optional, 160 chars
--   services      optional array (or comma string) of slugs: website, app,
--                 automation, developer, …   (max 8)
--   budget_band   optional: under_1k | 1k_2_5k | 2_5k_5k | 5k_10k | 10k_25k |
--                 25k_plus (the current form labels are mapped too)
--   timeline      optional: asap | 1_3_months | 3_6_months | 6_plus_months | exploring
--   message       optional, 5000 chars (newlines kept)
--   form          optional slug, default 'contact' ('import' never triggers
--                 the auto-reply, see 035)
--   source        optional: one of leads.source, default 'website'
--   attribution   optional {utm_*, referrer, landing_page, gclid, at,
--                 last:{…}} — first touch at the top level
--   consent       optional boolean; true stamps consent_at = now()
--   ip_hash       optional, salted hash computed by the Worker (LEAD_IP_SALT)
--   turnstile_ok  optional boolean; false (failed or unreachable) quarantines
--   spam_signals  optional array of spam signals from the route
--                 (e.g. "form_token_too_fast", "turnstile_failed"); any →
--                 quarantine ('signals' is read as well)
--   (extra keys the route sends, such as fill_ms, are ignored)
--
-- Returns {ok, lead_id, status}:
--   created      new lead, owner picked, SLA set, team notified
--   merged       an OPEN real lead with this address existed; the new message
--                is a 'resubmitted' activity on it and its owner is told
--   quarantined  stored with spam = true; no owner, no SLA, no notification,
--                no n8n side effects. Rescued with "not spam" in the app.
--   throttled    ok = false and nothing stored (lead_id null), plus
--                reason: 'visitor' (this ip_hash, or the shared no-ip_hash
--                bucket), 'address' (this email) or 'global' (the overall
--                cap). The route emails 'address' and 'global' briefs through
--                its fallback, since the sender did nothing wrong.
-- A wrong or missing secret raises 42501 (PostgREST 401/403); a payload with
-- no usable name or email raises 22023 (PostgREST 400). The route should
-- treat both as "intake failed" and use its formsubmit fallback.
-- No real lead is ever rejected for looking like spam: quarantine keeps it.
CREATE OR REPLACE FUNCTION public.intake_site_lead(p_secret text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret    text;
  p           jsonb;
  v_name      text;
  v_email     text;
  v_norm      text;
  v_phone     text;
  v_company   text;
  v_services  text[];
  v_budget    text;
  v_timeline  text;
  v_message   text;
  v_form      text;
  v_source    text;
  v_attr      jsonb;
  v_consent   timestamptz;
  v_ip        text;
  v_reasons   text[] := '{}';
  v_spam      boolean;
  v_client    uuid;
  v_owner     uuid;
  v_settings  record;
  v_lead      public.leads%ROWTYPE;
  v_lead_id   uuid;
  v_status    text;
  v_throttle  text;
  v_title     text;
  v_body      text;
  v_rule      text := 'pool';
BEGIN
  -- Fail closed: no Vault row, an empty or short one, or a mismatch.
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'lead_intake_secret'
     LIMIT 1;
  EXCEPTION WHEN others THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR char_length(v_secret) < 16
     OR p_secret IS NULL OR p_secret IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid lead' USING ERRCODE = '22023';
  END IF;
  p := p_payload;

  -- ---- Clean every field. Control characters go and runs of whitespace
  -- collapse (newlines stay in the message); every value is cut to the
  -- column's bound.
  v_name    := nullif(left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 120), '');
  v_email   := btrim(coalesce(p ->> 'email', ''));
  v_phone   := nullif(left(btrim(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+()./ x-]', '', 'g')), 40), '');
  v_company := nullif(left(btrim(regexp_replace(coalesce(p ->> 'company', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 160), '');
  v_message := nullif(left(btrim(regexp_replace(replace(replace(coalesce(p ->> 'message', ''), E'\r\n', E'\n'), E'\r', E'\n'),
                                                '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')), 5000), '');
  v_services := public.lead_services(p -> 'services');
  v_budget   := public.lead_budget_band(p ->> 'budget_band');
  v_timeline := public.lead_timeline(p ->> 'timeline');
  v_attr     := public.lead_clean_attribution(p -> 'attribution');
  v_ip       := nullif(left(btrim(coalesce(p ->> 'ip_hash', '')), 128), '');

  v_form := lower(btrim(coalesce(p ->> 'form', '')));
  IF v_form !~ '^[a-z0-9_-]{1,32}$' THEN
    v_form := 'contact';
  END IF;
  v_source := lower(btrim(coalesce(p ->> 'source', '')));
  IF v_source NOT IN ('seo', 'referral', 'linkedin', 'outbound', 'website', 'other') THEN
    v_source := 'website';
  END IF;
  IF jsonb_typeof(p -> 'consent') = 'boolean' AND (p ->> 'consent')::boolean THEN
    v_consent := now();
  END IF;

  IF v_name IS NULL OR v_email = '' OR char_length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$' THEN
    RAISE EXCEPTION 'invalid lead' USING ERRCODE = '22023';
  END IF;
  v_norm := lower(v_email);

  -- One intake per address at a time: two submits of the same form racing
  -- each other would otherwise both miss the open lead and create two.
  PERFORM pg_advisory_xact_lock(hashtext('public.intake_site_lead:' || v_norm));

  -- ---- Spam signals. Turnstile failing (or Cloudflare being unreachable)
  -- is the route's call; the database adds a link-stuffing check. Worked out
  -- before the throttle, which caps junk and real briefs separately.
  IF jsonb_typeof(p -> 'turnstile_ok') = 'boolean' AND NOT (p ->> 'turnstile_ok')::boolean THEN
    v_reasons := v_reasons || 'turnstile_failed'::text;
  END IF;
  -- /api/contact sends them as spam_signals; 'signals' is accepted too.
  v_reasons := v_reasons || ARRAY(
    SELECT DISTINCT left(trim(both '_' FROM regexp_replace(lower(s), '[^a-z0-9_]+', '_', 'g')), 40)
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p -> 'spam_signals') = 'array' THEN p -> 'spam_signals' ELSE '[]'::jsonb END
             || CASE WHEN jsonb_typeof(p -> 'signals') = 'array' THEN p -> 'signals' ELSE '[]'::jsonb END) AS s
     WHERE btrim(s) <> ''
     LIMIT 5);
  IF (SELECT count(*) FROM regexp_matches(coalesce(v_message, ''), 'https?://', 'gi')) >= 4 THEN
    v_reasons := v_reasons || 'many_links'::text;
  END IF;
  v_reasons := ARRAY(SELECT DISTINCT r FROM unnest(v_reasons) AS r WHERE r <> '' ORDER BY r);
  v_spam := cardinality(v_reasons) > 0;

  -- ---- Throttle. Only calls that got through count (the ledger holds no
  -- refusals), so nobody can keep the form shut by being refused.
  --   visitor  per ip_hash: 5 in 10 minutes, 20 a day. Calls without an
  --            ip_hash share ONE bucket of 10 in 10 minutes: the route
  --            always sends one, so only a direct caller holding the secret
  --            omits it, and omitting it must not mean "no limit".
  --   address  3 in 10 minutes, 10 a day. A real brief counts only real
  --            briefs for the address, so junk sent in a prospect's name
  --            (Turnstile failing) cannot lock the prospect out.
  --   global   60 real briefs in 10 minutes, which caps the damage if the
  --            secret leaks and the caller rotates ip_hash and addresses;
  --            quarantined briefs have their own cap of 200, so a flood that
  --            fails Turnstile never uses up real-lead capacity.
  v_throttle := CASE
    WHEN v_ip IS NOT NULL AND (
           (SELECT count(*) FROM public.lead_intake_attempts
             WHERE ip_hash = v_ip AND status <> 'throttled'
               AND at > now() - interval '10 minutes') >= 5
        OR (SELECT count(*) FROM public.lead_intake_attempts
             WHERE ip_hash = v_ip AND status <> 'throttled'
               AND at > now() - interval '1 day') >= 20)
      THEN 'visitor'
    WHEN v_ip IS NULL AND
           (SELECT count(*) FROM public.lead_intake_attempts
             WHERE ip_hash IS NULL AND status <> 'throttled'
               AND at > now() - interval '10 minutes') >= 10
      THEN 'visitor'
    WHEN (SELECT count(*) FROM public.lead_intake_attempts
           WHERE email_norm = v_norm
             AND (status IN ('created', 'merged') OR (v_spam AND status = 'quarantined'))
             AND at > now() - interval '10 minutes') >= 3
      OR (SELECT count(*) FROM public.lead_intake_attempts
           WHERE email_norm = v_norm
             AND (status IN ('created', 'merged') OR (v_spam AND status = 'quarantined'))
             AND at > now() - interval '1 day') >= 10
      THEN 'address'
    WHEN NOT v_spam AND
           (SELECT count(*) FROM public.lead_intake_attempts
             WHERE status IN ('created', 'merged')
               AND at > now() - interval '10 minutes') >= 60
      THEN 'global'
    WHEN v_spam AND
           (SELECT count(*) FROM public.lead_intake_attempts
             WHERE status = 'quarantined'
               AND at > now() - interval '10 minutes') >= 200
      THEN 'global'
  END;
  IF v_throttle IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'lead_id', NULL, 'status', 'throttled', 'reason', v_throttle);
  END IF;

  SELECT * INTO v_settings FROM public.growth_settings();

  -- ---- Quarantine: stored so no real lead is lost, but nobody is pinged
  -- and n8n never sees it (035's trigger skips spam rows).
  IF v_spam THEN
    INSERT INTO public.leads
      (name, email, phone, company, services, budget_band, timeline, message, form,
       source, attribution, consent_at, ip_hash, spam, spam_reason, stage,
       last_submitted_at)
    VALUES
      (v_name, v_email, v_phone, v_company, v_services, v_budget, v_timeline, v_message, v_form,
       v_source, v_attr, v_consent, v_ip, true, left(array_to_string(v_reasons, ','), 200), 'new',
       now())
    RETURNING id INTO v_lead_id;

    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_lead_id, NULL, 'submitted', jsonb_strip_nulls(jsonb_build_object(
      'form', v_form, 'source', v_source, 'message', v_message, 'services', to_jsonb(v_services),
      'budget_band', v_budget, 'timeline', v_timeline, 'quarantined', true,
      'reasons', to_jsonb(v_reasons))));

    INSERT INTO public.lead_intake_attempts (ip_hash, email_norm, lead_id, status)
    VALUES (v_ip, v_norm, v_lead_id, 'quarantined');
    RETURN jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'status', 'quarantined');
  END IF;

  -- ---- An enquiry from a current client's address is an upsell or a
  -- support request, not a cold lead.
  SELECT c.id INTO v_client
    FROM public.clients c
   WHERE lower(btrim(c.email)) = v_norm
   ORDER BY c.created_at
   LIMIT 1;

  -- ---- Merge into the newest OPEN real lead with this address. Knowing
  -- someone's email is all it takes to send a brief in their name, so a
  -- resubmission only fills blanks: it never replaces the phone, company,
  -- budget, timeline, message or consent already on the lead (staff would
  -- otherwise call whoever typed the newest number). Everything the new brief
  -- claimed is kept on its 'resubmitted' activity, where staff can check it
  -- and apply it by hand. Services only ever grow.
  SELECT * INTO v_lead
    FROM public.leads l
   WHERE l.email_norm = v_norm
     AND l.spam = false
     AND l.stage IN ('new', 'contacted', 'proposal')
   ORDER BY l.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.leads l
       SET phone              = coalesce(l.phone, v_phone),
           company            = coalesce(l.company, v_company),
           services           = ARRAY(SELECT DISTINCT unnest(l.services || v_services) LIMIT 8),
           budget_band        = coalesce(l.budget_band, v_budget),
           timeline           = coalesce(l.timeline, v_timeline),
           message            = coalesce(l.message, v_message),
           attribution        = coalesce(l.attribution, v_attr),
           consent_at         = coalesce(l.consent_at, v_consent),
           ip_hash            = coalesce(l.ip_hash, v_ip),
           existing_client_id = coalesce(l.existing_client_id, v_client),
           submission_count   = l.submission_count + 1,
           last_submitted_at  = now()
     WHERE l.id = v_lead.id;
    v_lead_id := v_lead.id;
    v_owner := v_lead.owner_id;
    v_status := 'merged';

    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_lead_id, NULL, 'resubmitted', jsonb_strip_nulls(jsonb_build_object(
      'form', v_form, 'name', v_name, 'phone', v_phone, 'company', v_company,
      'message', v_message, 'services', to_jsonb(v_services),
      'budget_band', v_budget, 'timeline', v_timeline, 'attribution', v_attr,
      'consent', CASE WHEN v_consent IS NOT NULL THEN true END,
      'submission', v_lead.submission_count + 1)));
  ELSE
    -- Route a client's enquiry to whoever runs that account (the assignee of
    -- its most recent project, if they can work leads); everyone else goes
    -- round the owner pool.
    IF v_client IS NOT NULL THEN
      SELECT pr.assignee_id INTO v_owner
        FROM public.projects pr
       WHERE pr.client_id = v_client
         AND pr.assignee_id IS NOT NULL
         AND public.user_has_perm(pr.assignee_id, 'growth', 'edit')
       ORDER BY pr.updated_at DESC
       LIMIT 1;
      IF v_owner IS NOT NULL THEN
        v_rule := 'account';
      END IF;
    END IF;
    IF v_owner IS NULL THEN
      v_owner := public.pick_lead_owner();
    END IF;

    INSERT INTO public.leads
      (name, email, phone, company, services, budget_band, timeline, message, form,
       source, attribution, consent_at, ip_hash, existing_client_id, owner_id, stage,
       sla_due_at, last_submitted_at)
    VALUES
      (v_name, v_email, v_phone, v_company, v_services, v_budget, v_timeline, v_message, v_form,
       v_source, v_attr, v_consent, v_ip, v_client, v_owner, 'new',
       public.add_business_minutes(now(), v_settings.sla_minutes, v_settings.business_hours),
       now())
    RETURNING id INTO v_lead_id;
    v_status := 'created';

    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_lead_id, NULL, 'submitted', jsonb_strip_nulls(jsonb_build_object(
      'form', v_form, 'source', v_source, 'message', v_message, 'services', to_jsonb(v_services),
      'budget_band', v_budget, 'timeline', v_timeline, 'attribution', v_attr,
      'existing_client_id', v_client)));

    IF v_owner IS NOT NULL THEN
      INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
      VALUES (v_lead_id, NULL, 'assigned', jsonb_build_object(
        'owner_id', v_owner, 'auto', true, 'rule', v_rule));
    END IF;
  END IF;

  -- ---- Tell people. actor_id is NULL: the actor is the website, and this
  -- runs with no auth.uid(), so 033's guard does not apply; recipients are
  -- chosen with user_has_perm() instead. The owner hears about every
  -- submission; Growth editors only about new leads (growth_notify_all).
  SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id;
  -- Read back from the lead, not the payload: on a merge the lead kept its
  -- own name and company, and the notification must not repeat what an
  -- unchecked resubmission claimed.
  v_title := left(CASE
    WHEN v_status = 'merged' THEN 'Lead wrote again: ' || v_lead.name
    WHEN v_client IS NOT NULL THEN 'Client enquiry: ' || v_lead.name
    ELSE 'New lead: ' || v_lead.name
  END, 300);
  v_body := left(concat_ws(' · ',
    v_lead.company,
    nullif(array_to_string(v_lead.services, ', '), ''),
    v_lead.budget_band,
    CASE WHEN v_lead.score > 0 THEN 'score ' || v_lead.score END,
    CASE WHEN v_status = 'created' AND v_lead.sla_due_at IS NOT NULL
         THEN 'reply by ' || to_char(v_lead.sla_due_at AT TIME ZONE coalesce(v_settings.business_hours ->> 'tz', 'UTC'), 'Dy HH24:MI') END
  ), 1000);

  INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
  SELECT r.id, NULL,
         CASE WHEN r.id = v_owner AND v_status = 'created' THEN 'lead_assigned' ELSE 'lead_new' END,
         v_title, v_body, 'lead', v_lead_id
    FROM public.profiles r
   WHERE (r.id = v_owner AND public.user_has_perm(r.id, 'growth', 'view'))
      OR (v_status = 'created' AND v_settings.notify_all
          AND public.user_has_perm(r.id, 'growth', 'edit'));

  INSERT INTO public.lead_intake_attempts (ip_hash, email_norm, lead_id, status)
  VALUES (v_ip, v_norm, v_lead_id, v_status);

  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.intake_site_lead(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intake_site_lead(text, jsonb) TO anon, service_role;
