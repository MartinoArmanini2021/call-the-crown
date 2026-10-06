-- =====================================================================================================
-- 0049 - deleting several accounts in one statement keeps ranks 1..n (audit 5-6 Oct 2026, finding M7;
-- decided by Tino on 6 Oct 2026).
-- close_rank_gap (0015) was a FOR EACH ROW trigger that moved everyone below old.rank up one place. When
-- one statement deletes several standings rows (an operator clearing test accounts, a cascade from
-- auth.users), the row triggers fire after all the deletions with the ranks as they were, so the result
-- depended on their order: deleting ranks 4 and 17 together gave ..., 15, 17, 17, 18. After the final no
-- settlement re-ranks, so the gap would stay on the prize places.
-- Now one statement-level trigger (the style of 0027) renumbers the ranked rows 1..n in their current
-- order: order-independent, and a no-op when only unranked rows (test accounts, 0025) were deleted. It
-- takes the same lock as rank_new_fan (0025), so a sign-up taking "the next place" and a deletion closing
-- a gap run one after the other, never interleaved.
-- =====================================================================================================
create or replace function public.close_rank_gap() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  if not exists (select 1 from gone where rank is not null) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('skg.rank_new_fan'));
  perform set_config('skg.settling', '1', true);
  update public.standings s
     set rank = x.rn, updated_at = clock_timestamp()
    from (select user_id, (row_number() over (order by rank, user_id))::int as rn
            from public.standings where rank is not null) x
   where s.user_id = x.user_id and s.rank is distinct from x.rn;
  perform set_config('skg.settling', v_prev, true);
  return null;
end;
$$;
revoke all on function public.close_rank_gap() from public, anon, authenticated;

drop trigger standings_close_rank_gap on public.standings;
create trigger standings_close_rank_gap after delete on public.standings
  referencing old table as gone
  for each statement execute function public.close_rank_gap();
