-- ============================================
-- DeskDev Studio — 041: Showcase link checker
--
-- 037 left the link check (B3) as an entry point with nothing calling it:
-- showcase_record_link_check() marks a link down after three failures in a
-- row, and the anon policy then takes that card off the public site. This
-- file adds the checker itself, in the database, so no extra service has to
-- be deployed or kept alive:
--
--   1. showcase_link_checks        one row per request sent, with the answer
--   2. showcase_link_alive()       which answers count as "the site is up"
--   3. showcase_link_check_tick()  collects answers, then starts the checks
--                                  that are due (pg_net)
--   4. cron: every 15 minutes
--   5. the six product demos whose public deployments are gone become
--      private links ("Demo on request") instead of dead links
--
-- Depends on: 037 (showcase_items, showcase_record_link_check), 024 (pg_cron),
-- 008/026 (pg_net). Re-runnable.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------- 1. The request ledger ----------
-- pg_net answers asynchronously: http_get() returns a request id and the
-- answer lands in net._http_response a little later (kept about six hours).
-- This table ties a request to its item and keeps the outcome for a month,
-- which is also what the Showcase screen can show as "last checked".
CREATE TABLE IF NOT EXISTS public.showcase_link_checks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id       uuid NOT NULL REFERENCES public.showcase_items (id) ON DELETE CASCADE,
  request_id    bigint NOT NULL,
  url           text NOT NULL CHECK (char_length(url) <= 2048),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  ok            boolean,
  status_code   int,
  note          text CHECK (char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS showcase_link_checks_open_idx
  ON public.showcase_link_checks (requested_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS showcase_link_checks_item_idx
  ON public.showcase_link_checks (item_id, requested_at DESC);

ALTER TABLE public.showcase_link_checks ENABLE ROW LEVEL SECURITY;

-- Read-only for people who can see the Showcase; only the checker writes.
REVOKE ALL ON public.showcase_link_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.showcase_link_checks TO authenticated;
GRANT ALL ON public.showcase_link_checks TO service_role;

DROP POLICY IF EXISTS "showcase_link_checks_select" ON public.showcase_link_checks;
CREATE POLICY "showcase_link_checks_select"
  ON public.showcase_link_checks FOR SELECT TO authenticated
  USING (public.has_perm('showcase', 'view'));

-- ---------- 2. What counts as alive ----------
-- 2xx and 3xx are up. 401, 403, 405 and 429 are also up: the server answered
-- and is refusing a robot, which says nothing about what a visitor sees.
-- Everything else (404, 410, 5xx, a timeout, no answer, a DNS or TLS error)
-- is a failed check. One failure changes nothing; three in a row mark the
-- link down (037).
CREATE OR REPLACE FUNCTION public.showcase_link_alive(p_status int, p_timed_out boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_timed_out, false) THEN false
    WHEN p_status IS NULL THEN false
    WHEN p_status BETWEEN 200 AND 399 THEN true
    WHEN p_status IN (401, 403, 405, 429) THEN true
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.showcase_link_alive(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_link_alive(int, boolean) TO service_role;

-- ---------- 3. The tick ----------
-- Each run: (a) record the answers that have arrived, (b) count a request
-- with no answer after ten minutes as a failure, (c) start checks for items
-- that are due, a few at a time, (d) trim old history.
--
-- Due means: on the site or waiting for review, with a public http(s) link,
-- no request in flight, and either never checked, not checked for a day, or
-- failing (retried every two hours so three strikes take hours, not days).
-- A link that is down is still checked daily, so its card returns by itself
-- when the site does. Private links are never requested: the address is not
-- shown to visitors, and DeskDev should not announce itself to a private app.
CREATE OR REPLACE FUNCTION public.showcase_link_check_tick(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          record;
  v_ok       boolean;
  v_req      bigint;
  v_resolved int := 0;
  v_expired  int := 0;
  v_started  int := 0;
BEGIN
  IF to_regclass('net._http_response') IS NOT NULL THEN
    FOR r IN
      SELECT c.id, c.item_id, resp.status_code, resp.timed_out, resp.error_msg
        FROM public.showcase_link_checks c
        JOIN net._http_response resp ON resp.id = c.request_id
       WHERE c.resolved_at IS NULL
       ORDER BY c.id
    LOOP
      v_ok := public.showcase_link_alive(r.status_code, r.timed_out);
      PERFORM public.showcase_record_link_check(r.item_id, v_ok);
      UPDATE public.showcase_link_checks
         SET resolved_at = now(),
             ok          = v_ok,
             status_code = r.status_code,
             note        = left(CASE WHEN r.timed_out THEN 'timed out' ELSE r.error_msg END, 200)
       WHERE id = r.id;
      v_resolved := v_resolved + 1;
    END LOOP;
  END IF;

  FOR r IN
    SELECT c.id, c.item_id
      FROM public.showcase_link_checks c
     WHERE c.resolved_at IS NULL AND c.requested_at < now() - interval '10 minutes'
     ORDER BY c.id
  LOOP
    PERFORM public.showcase_record_link_check(r.item_id, false);
    UPDATE public.showcase_link_checks
       SET resolved_at = now(), ok = false, note = 'no response'
     WHERE id = r.id;
    v_expired := v_expired + 1;
  END LOOP;

  IF to_regprocedure('net.http_get(text, jsonb, jsonb, integer)') IS NOT NULL THEN
    FOR r IN
      SELECT s.id, s.url
        FROM public.showcase_items s
       WHERE s.status IN ('published', 'ready')
         AND s.link_public
         AND s.url ~* '^https?://'
         AND NOT EXISTS (
           SELECT 1 FROM public.showcase_link_checks c
            WHERE c.item_id = s.id AND c.resolved_at IS NULL
         )
         AND (
           s.link_checked_at IS NULL
           OR s.link_checked_at < now() - interval '24 hours'
           OR (s.link_fail_count > 0 AND s.link_status <> 'down'
               AND s.link_checked_at < now() - interval '2 hours')
         )
       ORDER BY s.link_checked_at NULLS FIRST, s.sort_order
       LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
    LOOP
      v_req := net.http_get(
        url := r.url,
        headers := jsonb_build_object(
          'User-Agent', 'Mozilla/5.0 (compatible; DeskDevLinkCheck/1.0)',
          'Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
        ),
        timeout_milliseconds := 15000
      );
      INSERT INTO public.showcase_link_checks (item_id, request_id, url)
      VALUES (r.id, v_req, left(r.url, 2048));
      v_started := v_started + 1;
    END LOOP;
  END IF;

  DELETE FROM public.showcase_link_checks WHERE resolved_at < now() - interval '30 days';

  RETURN jsonb_build_object('resolved', v_resolved, 'expired', v_expired, 'started', v_started);
END;
$$;

REVOKE ALL ON FUNCTION public.showcase_link_check_tick(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_link_check_tick(int) TO service_role;

-- ---------- 4. Schedule ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'showcase-link-check') THEN
    PERFORM cron.unschedule('showcase-link-check');
  END IF;
  PERFORM cron.schedule('showcase-link-check', '*/15 * * * *',
    $cron$ SELECT public.showcase_link_check_tick() $cron$);
END $$;

-- ---------- 5. Seed correction: product demos that no longer exist ----------
-- 038 seeded these six products with public demo addresses. Those
-- deployments have been removed (404 / 500 on 2026-10-04), so the public page
-- linked visitors to error pages. They stay on the page, as products whose
-- demo is given on request, until someone records a working public address
-- in DeskDev > Showcase. Only rows that still carry the seeded address and a
-- public link are touched, so an address fixed by hand is left alone.
UPDATE public.showcase_items
   SET link_public = false
 WHERE kind = 'product'
   AND link_public
   AND url IN (
     'https://inbox-ai-ten.vercel.app',
     'https://invoice-chase-brown.vercel.app',
     'https://stock-sense-delta.vercel.app',
     'https://supernova-dashboard.vercel.app',
     'https://pos-app-rho-neon.vercel.app',
     'https://elev8te-crm.vercel.app'
   );
