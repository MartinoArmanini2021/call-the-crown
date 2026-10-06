-- =====================================================================================================
-- 0046 - the tiebreak seed cannot be replaced by deleting the event row (audit 5-6 Oct 2026, finding M4;
-- applied on Tino's word, 6 Oct 2026).
-- guard_tiebreak_seed (0007) only fired BEFORE UPDATE, but the operator role holds DELETE and INSERT on
-- event_config: after play started, deleting the row and inserting it again replaced the seed, so the
-- draw was no longer "fixed before the first match" (How to play, tiebreaker 4). The same guard now also
-- refuses a DELETE once play has started (the row is single by its primary key, so nothing can be
-- inserted beside it; the operator has no TRUNCATE). Before play starts both stay allowed.
-- =====================================================================================================
create or replace function public.guard_tiebreak_seed() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.matches
     where status <> 'scheduled' or (starts_at is not null and starts_at <= public.app_now())
  ) then
    if tg_op = 'DELETE' then raise exception 'tiebreak_seed_locked'; end if;
    if new.tiebreak_seed is distinct from old.tiebreak_seed then raise exception 'tiebreak_seed_locked'; end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger event_config_seed_guard_delete before delete on public.event_config
  for each row execute function public.guard_tiebreak_seed();
revoke all on function public.guard_tiebreak_seed() from public, anon, authenticated, service_role;
