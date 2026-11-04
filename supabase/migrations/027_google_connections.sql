-- 027 — Google connections (one per person)
--
-- Google design: user-delegated OAuth, one connection per
-- team member, scope `drive.file` (the app sees only files it created). The
-- `google` edge function is the only reader and writer of this table; see
-- supabase/functions/google/README.md for the Cloud Console setup.
--
-- The refresh token is encrypted at rest
-- (AES-256-GCM, key = the GOOGLE_TOKEN_KEY function secret), so a leaked
-- table dump or backup is not a working Google grant. Format:
-- "v1.<iv b64url>.<ciphertext b64url>".
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS public.google_connections (
  user_id           uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  google_email      text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  refresh_token_enc text NOT NULL CHECK (refresh_token_enc LIKE 'v1.%'),
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- RLS on with NO policies: every anon/authenticated query is denied, and only
-- the service role (inside the edge function) can touch a row. A separate
-- table rather than columns on profiles, because profiles is readable by
-- every colleague.
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_connections FROM anon, authenticated;

DROP TRIGGER IF EXISTS google_connections_set_updated_at ON public.google_connections;
CREATE TRIGGER google_connections_set_updated_at
  BEFORE UPDATE ON public.google_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
