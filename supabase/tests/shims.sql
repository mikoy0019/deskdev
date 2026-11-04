-- Stand-ins for what a Supabase project has before the first migration runs.
-- Loaded once by harness.mjs into an empty PGlite database. Each block copies
-- the shape of the real thing as far as the migrations and the tests need it,
-- and says where it differs.

-- ---------- Roles ----------
-- The three API roles, PostgREST's login role, GoTrue's role and the platform
-- superuser. `postgres` already exists: in PGlite it is a superuser, on a
-- hosted project it is not (it owns everything in public but not auth.users).
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT NOLOGIN;
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_admin SUPERUSER NOLOGIN;
CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE NOLOGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default privileges: everything postgres creates in public is
-- open to the API roles until a migration takes it away. This is why a
-- migration has to REVOKE, and why the tests can tell when one forgot.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- ---------- auth (GoTrue) ----------
-- Owned by supabase_auth_admin, like the real schema. auth.users has the
-- columns the migrations, admin-users and the tests touch; GoTrue's has more.
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE TABLE auth.users (
  instance_id        uuid,
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aud                varchar(255) DEFAULT 'authenticated',
  role               varchar(255) DEFAULT 'authenticated',
  email              varchar(255),
  phone              text UNIQUE,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_sso_user        boolean NOT NULL DEFAULT false,
  is_anonymous       boolean NOT NULL DEFAULT false,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
-- GoTrue's partial unique index: one non-SSO account per address.
CREATE UNIQUE INDEX users_email_partial_key ON auth.users (email) WHERE is_sso_user = false;

-- The JWT helpers, as Supabase defines them: PostgREST puts the verified
-- token in request.jwt.claims (older versions: one setting per claim).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- ---------- Realtime ----------
CREATE PUBLICATION supabase_realtime;

-- ---------- pg_net ----------
-- Records what would have been sent instead of sending it. net._calls is the
-- test's window on it; net._http_response is where a test plants an answer.
CREATE SCHEMA net;
CREATE SEQUENCE net.request_id_seq;
CREATE TABLE net._calls (
  id      bigint PRIMARY KEY,
  method  text NOT NULL,
  url     text NOT NULL,
  headers jsonb,
  body    jsonb,
  params  jsonb
);
CREATE TABLE net._http_response (
  id           bigint,
  status_code  integer,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = net AS $$
  INSERT INTO net._calls (id, method, url, headers, body, params)
  VALUES (nextval('net.request_id_seq'), 'POST', url, headers, body, params) RETURNING id
$$;
CREATE FUNCTION net.http_get(
  url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = net AS $$
  INSERT INTO net._calls (id, method, url, headers, params)
  VALUES (nextval('net.request_id_seq'), 'GET', url, headers, params) RETURNING id
$$;
-- Like Supabase: the API roles cannot reach pg_net themselves.
REVOKE ALL ON SCHEMA net FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC;

-- ---------- pg_cron ----------
-- Keeps the schedule so a test can read it; nothing ever runs a job.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  jobname  text UNIQUE,
  schedule text NOT NULL,
  command  text NOT NULL,
  active   boolean NOT NULL DEFAULT true
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
  RETURNING jobid
$$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name;
  END IF;
  RETURN true;
END
$$;
REVOKE ALL ON SCHEMA cron FROM PUBLIC;

-- ---------- Vault ----------
-- Plain text instead of encryption: the migrations only need the names and
-- the decrypted view.
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO vault.secrets (name, description, secret) VALUES (new_name, new_description, new_secret) RETURNING id
$$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  UPDATE vault.secrets
     SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
         description = coalesce(new_description, description), updated_at = now()
   WHERE id = secret_id
$$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;

-- ---------- Storage ----------
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text REFERENCES storage.buckets (id),
  name       text,
  owner      uuid,
  owner_id   text,
  metadata   jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
