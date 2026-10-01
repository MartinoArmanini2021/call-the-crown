-- =====================================================================================================
-- LOCAL ONLY — the simulated clock. Never apply this to staging or production.
-- It replaces app_now() with "now plus an offset" so a whole event can be walked through in minutes.
-- Applied by scripts/sim-clock.ts and by the SQL test runner; it is not a migration on purpose, so no
-- real instance ever has a time-travel knob.
-- =====================================================================================================

create table if not exists public.dev_clock (
  id        boolean primary key default true check (id),
  shift     interval not null default '0'
);
insert into public.dev_clock (id) values (true) on conflict do nothing;
alter table public.dev_clock enable row level security;
revoke all on public.dev_clock from anon, authenticated, service_role;

-- SECURITY DEFINER so the lock checks and the picks policy can read the offset without anyone being
-- granted the table.
create or replace function public.app_now() returns timestamptz
language sql stable security definer
set search_path = public
as $$ select now() + coalesce((select shift from public.dev_clock), '0'::interval) $$;

-- Jump to an exact moment, e.g. select public.dev_set_now('2026-10-21 16:25+00');
create or replace function public.dev_set_now(p_at timestamptz) returns timestamptz
language plpgsql security definer
set search_path = public
as $$
begin
  update public.dev_clock set shift = p_at - now() where id;
  return public.app_now();
end;
$$;
revoke all on function public.dev_set_now(timestamptz) from public, anon, authenticated;
grant execute on function public.dev_set_now(timestamptz) to service_role;
