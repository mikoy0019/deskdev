-- 007_realtime.sql
-- Enable Postgres realtime for every data table so the web and mobile apps
-- stay in sync live (not just on reload). 006 already added `notifications`;
-- this covers the rest. Idempotent — safe to run more than once.
--
-- REPLICA IDENTITY FULL makes the full OLD row available on DELETE so RLS can
-- be evaluated and delete events reach subscribed clients.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'client_categories', 'clients', 'project_categories', 'projects',
    'tasks', 'task_activity', 'time_entries',
    'crm_tables', 'crm_columns', 'crm_rows', 'events', 'notifications'
  ]
  loop
    execute format('alter table public.%I replica identity full', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
