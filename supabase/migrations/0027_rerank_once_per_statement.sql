-- =====================================================================================================
-- 0027 — the test-account re-rank runs once per statement (Audit Part 1 review of 0025, Tino 5 Oct 2026)
-- The trigger of 0025 ran recompute_standings once per updated row: marking 60 accounts in one UPDATE
-- re-ranked everyone 60 times. It is now one run per UPDATE statement on profiles, and only when some
-- row's is_test actually changed (transition tables; a trigger with transition tables cannot carry a
-- column list, so the function compares is_test itself). Same function, still no client grant.
-- =====================================================================================================

-- The re-rank: once per UPDATE statement on profiles, only if some row's is_test changed.
drop trigger profiles_rerank_on_test_flag on public.profiles;

create or replace function public.rerank_on_test_flag() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  if not exists (select 1 from new_rows n join old_rows o on o.user_id = n.user_id
                  where n.is_test is distinct from o.is_test) then
    return null;
  end if;
  if not exists (select 1 from public.standings where rank is not null) then return null; end if;
  perform set_config('skg.settling', '1', true);
  perform public.recompute_standings();
  perform set_config('skg.settling', v_prev, true);
  return null;
end;
$$;
revoke all on function public.rerank_on_test_flag() from public, anon, authenticated, service_role;

create trigger profiles_rerank_on_test_flag after update on public.profiles
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.rerank_on_test_flag();
