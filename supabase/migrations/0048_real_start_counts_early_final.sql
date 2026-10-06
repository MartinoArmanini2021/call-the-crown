-- =====================================================================================================
-- 0048 - once the operator confirms an early start with lock_match_now, the real start also counts the
-- finals that were refused only for arriving early (audit 5-6 Oct 2026, F-03 residue; decided by Tino on
-- 6 Oct 2026).
-- 0018 ignores every refused reading. "final result before the scheduled start" (0016) is a reading with
-- the right players and a legal score, refused only so that nothing settles while picks are open. If the
-- poller's first look at a match that started early is already the final (it started more than 60 min
-- early, outside the poll window, e.g. a schedule typed in the wrong time zone), every in-play reading is
-- such a refusal and real_start() was null: nothing was void, and a fan who picked after the result was
-- public scored in full. Counting those refusals unconditionally would let a bogus early final that is
-- never reverted void honest picks (security.sql section 6), so they count only for a match the operator
-- locked early: lock_match_now is the human confirmation that the match really started before its
-- schedule. New column matches.locked_early_at, written by lock_match_now only.
-- Changes against 0016 (lock_match_now) and 0018 (real_start): the column write and the one condition.
-- Grants as before. Test: supabase/tests/early_final.sql.
-- =====================================================================================================
alter table public.matches add column locked_early_at timestamptz;   -- set by lock_match_now only

create or replace function public.lock_match_now(p_match int) returns void
language plpgsql security definer
set search_path = public
as $$
declare m public.matches%rowtype;
begin
  select * into m from public.matches where match_no = p_match for update;
  if not found then raise exception 'no_such_match'; end if;
  if m.status <> 'scheduled' or (m.starts_at is not null and m.starts_at <= public.app_now()) then
    raise exception 'match_started';
  end if;
  update public.matches set starts_at = public.app_now(), locked_early_at = public.app_now()
   where match_no = p_match;
end;
$$;
revoke all on function public.lock_match_now(int) from public, anon, authenticated;
grant execute on function public.lock_match_now(int) to service_role;

create or replace function public.real_start(p_match int) returns timestamptz
language sql stable
set search_path = public
as $$
  select min(r.seen_at)
    from public.result_log r
   where r.match_no = p_match
     and r.normalised->>'status' in ('live', 'completed', 'retired')
     and (r.outcome not like 'rejected%'
          or (r.note = 'final result before the scheduled start'      -- right players, legal score, early
              and exists (select 1 from public.matches m
                           where m.match_no = p_match and m.locked_early_at is not null)))
     and r.id > coalesce((select max(x.id) from public.result_log x
                           where x.match_no = p_match and x.normalised->>'status' = 'scheduled'), 0)
$$;
revoke all on function public.real_start(int) from public, anon, authenticated, service_role;
