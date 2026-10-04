-- =====================================================================================================
-- 0015 — leagues and ranks: fixes for audit findings F-10, F-11, F-12, F-14 and F-17 (3 Oct 2026)
-- F-17 Ranks were rebuilt only at settlement, so a deleted account left a hole in the positions
--      (1, 2, 3, 6, …) until the next result, and for good after the final. Now every deletion closes
--      the gap at once.
-- F-12 The league hand-over lived only in delete_account(); an account deleted any other way (the Auth
--      admin API, the dashboard: an operator handling an erasure request) took its leagues with it.
--      The hand-over is now a trigger on auth.users, so every deletion path runs it.
-- F-14 The owner deleting their account while their heir left at the same moment could leave an owner
--      who is not a member. The hand-over and leave_league now both lock the league row first.
-- F-11 Two league creations at once could take a fan past the 10-league cap. create_league now takes
--      the same per-fan lock as join_league before counting.
-- F-10 A member removed by the owner could rejoin at once with the same code. Removals are recorded,
--      and join_league refuses a removed member.
-- =====================================================================================================

-- F-17 -------------------------------------------------------------------------------------------------
-- After a standings row goes (its account was deleted), everyone ranked below moves up one place. The
-- update runs under the settlement marker (the score guard, 0006), restored afterwards.
create function public.close_rank_gap() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  perform set_config('skg.settling', '1', true);
  update public.standings set rank = rank - 1, updated_at = clock_timestamp() where rank > old.rank;
  perform set_config('skg.settling', v_prev, true);
  return old;
end;
$$;
revoke all on function public.close_rank_gap() from public, anon, authenticated;

create trigger standings_close_rank_gap after delete on public.standings
  for each row when (old.rank is not null) execute function public.close_rank_gap();

-- F-12 + F-14 ------------------------------------------------------------------------------------------
-- Before an account is deleted, by any path: each league it owns passes to its longest-standing other
-- member, or is deleted when nobody else is in it (the rule of 0005, unchanged). The league row is
-- locked first, so a member leaving at the same moment either finishes before (and is not the heir) or
-- waits and finds they now own the league.
create function public.hand_over_leagues() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_l    record;
  v_next uuid;
begin
  for v_l in select id from public.leagues where owner_id = old.id order by id for update loop
    select user_id into v_next from public.league_members
     where league_id = v_l.id and user_id <> old.id order by joined_at, user_id limit 1;
    if v_next is null then
      delete from public.leagues where id = v_l.id;
    else
      update public.leagues set owner_id = v_next where id = v_l.id;
    end if;
  end loop;
  return old;
end;
$$;
revoke all on function public.hand_over_leagues() from public, anon, authenticated;

create trigger hand_over_leagues before delete on auth.users
  for each row execute function public.hand_over_leagues();

-- delete_account keeps its signature; the hand-over now happens in the trigger.
create or replace function public.delete_account() returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  delete from auth.users where id = v_uid;   -- hand_over_leagues runs first, then the cascades
end;
$$;

create or replace function public.leave_league(p_league uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  -- Lock the league row: a hand-over in progress finishes first (F-14).
  select owner_id into v_owner from public.leagues where id = p_league for update;
  if v_owner = v_uid then
    raise exception 'owner_cannot_leave';   -- the owner deletes the league instead
  end if;
  delete from public.league_members where league_id = p_league and user_id = v_uid;
  if not found then raise exception 'not_a_member'; end if;
end;
$$;

-- F-11 -------------------------------------------------------------------------------------------------
create or replace function public.create_league(p_name text) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_max  int;
  v_id   uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'league_name_length'; end if;
  -- The same per-fan lock join_league takes, so two creations (or a creation and a join) at once
  -- count one after the other (F-11).
  perform 1 from public.profiles where user_id = v_uid for update;
  select (league_limits->>'max_leagues_per_user')::int into v_max from public.event_config;
  if (select count(*) from public.league_members where user_id = v_uid) >= v_max then
    raise exception 'too_many_leagues';
  end if;

  for i in 1..8 loop
    begin
      v_code := public.gen_league_code();
      insert into public.leagues (name, code, owner_id) values (v_name, v_code, v_uid) returning id into v_id;
      exit;
    exception when unique_violation then
      if i = 8 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;

  insert into public.league_members (league_id, user_id) values (v_id, v_uid);
  return jsonb_build_object('id', v_id, 'code', v_code, 'name', v_name);
end;
$$;

-- F-10 -------------------------------------------------------------------------------------------------
create table public.league_removals (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  removed_at timestamptz not null default clock_timestamp(),
  primary key (league_id, user_id)
);
alter table public.league_removals enable row level security;
revoke all on public.league_removals from anon, authenticated;
-- No policy: written by remove_member, read by join_league.

create or replace function public.remove_member(p_league uuid, p_user uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.leagues where id = p_league and owner_id = v_uid) then
    raise exception 'not_league_owner';
  end if;
  if p_user = v_uid then raise exception 'owner_cannot_leave'; end if;
  delete from public.league_members where league_id = p_league and user_id = p_user;
  if not found then raise exception 'not_a_member'; end if;
  insert into public.league_removals (league_id, user_id) values (p_league, p_user)
  on conflict do nothing;
end;
$$;

create or replace function public.join_league(p_code text) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := clock_timestamp();
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_limits jsonb;
  v_prof   public.profiles%rowtype;
  v_league public.leagues%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select league_limits into v_limits from public.event_config;

  select * into v_prof from public.profiles where user_id = v_uid for update;
  if v_prof.join_fail_at is not null and v_prof.join_fail_at > v_now - interval '10 minutes'
     and v_prof.join_fail_count >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_league from public.leagues where code = v_code for update;
  if not found then
    update public.profiles
       set join_fail_count = case when join_fail_at is null or join_fail_at <= v_now - interval '10 minutes'
                                  then 1 else join_fail_count + 1 end,
           join_fail_at    = case when join_fail_at is null or join_fail_at <= v_now - interval '10 minutes'
                                  then v_now else join_fail_at end
     where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'league_not_found');
  end if;

  if exists (select 1 from public.league_members where league_id = v_league.id and user_id = v_uid) then
    return jsonb_build_object('ok', true, 'league_id', v_league.id, 'name', v_league.name);
  end if;
  if exists (select 1 from public.league_removals where league_id = v_league.id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'removed_from_league');
  end if;
  if (select count(*) from public.league_members where user_id = v_uid)
     >= (v_limits->>'max_leagues_per_user')::int then
    return jsonb_build_object('ok', false, 'error', 'too_many_leagues');
  end if;
  if (select count(*) from public.league_members where league_id = v_league.id)
     >= (v_limits->>'max_members')::int then
    return jsonb_build_object('ok', false, 'error', 'league_full');
  end if;

  insert into public.league_members (league_id, user_id) values (v_league.id, v_uid);
  return jsonb_build_object('ok', true, 'league_id', v_league.id, 'name', v_league.name);
end;
$$;
