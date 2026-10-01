-- =====================================================================================================
-- 0001 — closed by default
-- Supabase's default privileges hand anon and authenticated INSERT/UPDATE/DELETE/TRUNCATE on every new
-- table, and EXECUTE on every new function goes to PUBLIC. RLS does not govern TRUNCATE. So the first
-- thing this instance does is turn those defaults off; every later migration grants only what it means.
-- Pattern from tennis-fantasy/supabase/2026-09-24_six_kings_picks.sql (revoke all, then grant select).
-- =====================================================================================================

-- service_role is included on purpose. It keeps BYPASSRLS, but it gets table and function rights only
-- where a later migration grants them, so even the holder of the service key writes through the RPCs
-- and has no direct path to a result, a pick score or the result log.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;
-- EXECUTE to PUBLIC is a global default, so it can only be removed globally (not per schema).
alter default privileges revoke execute on functions from public;

-- The one clock every lock, visibility rule and billing day reads. In every real environment it is the
-- server's now(). Only the local-only file supabase/dev/sim_clock.sql ever replaces it.
create function public.app_now() returns timestamptz
language sql stable
set search_path = public
as $$ select now() $$;

grant execute on function public.app_now() to anon, authenticated, service_role;
