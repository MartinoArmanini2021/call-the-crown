-- =====================================================================================================
-- 0017 — a fan who joins after a result is on the board at once (Tino, 4 Oct 2026; audit P8-04)
-- Ranks were rebuilt only at settlement, so an account created after a result had no rank: missing
-- from the leaderboard until the next result, and for good after the final ("The table fills after the
-- first result" even though results existed). Now, once any result has been settled, a new account is
-- ranked straight away, last: it has 0 points and cannot pass anyone. The next settlement ranks
-- everyone again with every tiebreaker (0006). Before the first result nobody has a rank, as before.
-- =====================================================================================================

create function public.rank_new_fan() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  if not exists (select 1 from public.standings where rank is not null) then return new; end if;
  -- One new fan at a time takes the next place (two sign-ups in the same instant never share one).
  perform pg_advisory_xact_lock(hashtext('skg.rank_new_fan'));
  perform set_config('skg.settling', '1', true);
  update public.standings
     set rank = (select coalesce(max(rank), 0) + 1 from public.standings), updated_at = clock_timestamp()
   where user_id = new.user_id and rank is null;
  perform set_config('skg.settling', v_prev, true);
  return new;
end;
$$;
revoke all on function public.rank_new_fan() from public, anon, authenticated;

create trigger standings_rank_new_fan after insert on public.standings
  for each row execute function public.rank_new_fan();
