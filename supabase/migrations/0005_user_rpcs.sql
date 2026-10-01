-- =====================================================================================================
-- 0005 — everything a fan can write, and the boards a fan can read
-- Every function: SECURITY DEFINER, fixed search_path, EXECUTE revoked from public and anon, granted to
-- authenticated only. Errors are short codes; the app turns them into sentences (src/i18n/strings.ts).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- New account → profile, standings row, and the two consents exactly as shown on the sign-up screen.
-- Pattern from tennis-fantasy/supabase/schema.sql (handle_new_user).
-- ---------------------------------------------------------------------------------------------------
create function public.clean_display_name(p_name text) returns text
language sql immutable
set search_path = public
as $$
  select case when char_length(n) between 2 and 24 then n end
    from (select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')) as n) s
$$;

create function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_version text;
begin
  insert into public.profiles (user_id, display_name, locale)
  values (new.id,
          public.clean_display_name(v_meta->>'display_name'),
          case when v_meta->>'locale' in ('en', 'ar') then v_meta->>'locale' else 'en' end)
  on conflict (user_id) do nothing;

  insert into public.standings (user_id) values (new.id) on conflict (user_id) do nothing;

  v_version := coalesce(nullif(v_meta->>'consent_text_version', ''),
                        (select privacy->>'version' from public.event_config), 'unknown');
  insert into public.consents (user_id, party, granted, text_version) values
    (new.id, 'organiser', coalesce((v_meta->>'consent_organiser')::boolean, false), v_version),
    (new.id, 'gsgm',      coalesce((v_meta->>'consent_gsgm')::boolean, false),      v_version);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------------
-- save_pick — the only way a prediction is written. One upsert; the server decides who, when and
-- which day. Skeleton from tennis-fantasy/supabase/2026-09-24_six_kings_picks.sql.
-- ---------------------------------------------------------------------------------------------------
create function public.save_pick(p_match int, p_winner text, p_sets int, p_set_scores jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := public.app_now();
  m       public.matches%rowtype;
  v_slot  int;
  v_err   text;
  v_canon jsonb;
  v_rows  int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select * into m from public.matches where match_no = p_match;
  if not found then raise exception 'no_such_match'; end if;
  if m.p1_id is null or m.p2_id is null then raise exception 'players_unknown'; end if;
  if m.starts_at is null then raise exception 'no_start_time'; end if;
  if v_now >= m.starts_at then raise exception 'locked'; end if;
  if m.status <> 'scheduled' then raise exception 'already_settled'; end if;

  v_slot := case when p_winner = m.p1_id then 1 when p_winner = m.p2_id then 2 end;
  if v_slot is null then raise exception 'winner_not_in_match'; end if;

  v_err := public.validate_set_scores(v_slot, p_sets, p_set_scores);
  if v_err is not null then raise exception '%', v_err; end if;
  v_canon := public.canonical_set_scores(p_set_scores);

  insert into public.picks as p (user_id, match_no, winner_id, sets, set_scores, created_at, updated_at)
  values (v_uid, p_match, p_winner, p_sets, v_canon, v_now, v_now)
  on conflict (user_id, match_no) do update
     set winner_id = excluded.winner_id, sets = excluded.sets, set_scores = excluded.set_scores,
         updated_at = excluded.updated_at
   where (p.winner_id, p.sets, p.set_scores) is distinct from
         (excluded.winner_id, excluded.sets, excluded.set_scores);
  get diagnostics v_rows = row_count;

  -- The billing record. Only a new pick or a real change counts; the day is the server's Riyadh day.
  if v_rows > 0 then
    insert into public.activity_days (user_id, day)
    values (v_uid, (v_now at time zone (select timezone from public.event_config))::date)
    on conflict do nothing;
  end if;

  return jsonb_build_object('changed', v_rows > 0);
end;
$$;
revoke all on function public.save_pick(int, text, int, jsonb) from public, anon;
grant execute on function public.save_pick(int, text, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Friends leagues. Patterns from tennis-fantasy/supabase/harden_and_scale_2.sql (create with collision
-- retry), schema.sql (join) and launch_prep.sql (owner guards); the member cap, the per-user league cap
-- and the wrong-code throttle are new here.
-- ---------------------------------------------------------------------------------------------------
create function public.gen_league_code() returns text
language sql volatile
set search_path = public
as $$
  -- 6 characters from 32 that cannot be misread (no I, O, 0, 1); the bytes come from gen_random_uuid().
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + (get_byte(b, i) % 32), 1), '' order by i)
    from (select uuid_send(gen_random_uuid()) as b) s, generate_series(0, 5) i
$$;
revoke all on function public.gen_league_code() from public, anon, authenticated;

create function public.create_league(p_name text) returns jsonb
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

-- Returns {ok: true, league_id, name} or {ok: false, error}. It does not raise on a wrong code, because
-- a raise would roll back the wrong-code counter that throttles guessing.
create function public.join_league(p_code text) returns jsonb
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

create function public.leave_league(p_league uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.leagues where id = p_league and owner_id = v_uid) then
    raise exception 'owner_cannot_leave';   -- the owner deletes the league instead
  end if;
  delete from public.league_members where league_id = p_league and user_id = v_uid;
  if not found then raise exception 'not_a_member'; end if;
end;
$$;

create function public.remove_member(p_league uuid, p_user uuid) returns void
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
end;
$$;

create function public.delete_league(p_league uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  delete from public.leagues where id = p_league and owner_id = v_uid;
  if not found then raise exception 'not_league_owner'; end if;
end;
$$;

create function public.my_leagues()
returns table (id uuid, name text, code text, is_owner boolean, member_count int)
language sql stable security definer
set search_path = public
as $$
  select l.id, l.name, l.code, l.owner_id = auth.uid(),
         (select count(*)::int from public.league_members x where x.league_id = l.id)
    from public.leagues l
    join public.league_members me on me.league_id = l.id and me.user_id = auth.uid()
   order by l.created_at
$$;

-- ---------------------------------------------------------------------------------------------------
-- Profile, consents, account
-- ---------------------------------------------------------------------------------------------------
create function public.update_profile(p_display_name text, p_locale text default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := public.clean_display_name(p_display_name);
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if v_name is null then raise exception 'display_name_length'; end if;
  if p_locale is not null and p_locale not in ('en', 'ar') then raise exception 'bad_locale'; end if;
  update public.profiles
     set display_name = v_name, locale = coalesce(p_locale, locale)
   where user_id = v_uid;
end;
$$;

-- Appends a consent row for each party whose answer changed, with the version of the text shown.
create function public.update_consents(p_organiser boolean, p_gsgm boolean, p_text_version text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_organiser is null or p_gsgm is null or coalesce(btrim(p_text_version), '') = '' then
    raise exception 'consent_incomplete';
  end if;
  for r in select * from (values ('organiser', p_organiser), ('gsgm', p_gsgm)) as v(party, granted) loop
    if r.granted is distinct from (
      select c.granted from public.consents c
       where c.user_id = v_uid and c.party = r.party order by c.changed_at desc limit 1
    ) then
      insert into public.consents (user_id, party, granted, text_version)
      values (v_uid, r.party, r.granted, btrim(p_text_version));
    end if;
  end loop;
end;
$$;

-- Deletes the caller's account and everything hanging off it (picks, consents, standings row, activity
-- days, memberships). A league the caller owns passes to its longest-standing other member; with no
-- other member it is deleted. (Plan, open question 10.)
create function public.delete_account() returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_l    record;
  v_next uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  for v_l in select id from public.leagues where owner_id = v_uid for update loop
    select user_id into v_next from public.league_members
     where league_id = v_l.id and user_id <> v_uid order by joined_at, user_id limit 1;
    if v_next is null then
      delete from public.leagues where id = v_l.id;
    else
      update public.leagues set owner_id = v_next where id = v_l.id;
    end if;
  end loop;
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Boards. The global league is the standings table; a friends league is the same rows filtered to its
-- members, re-numbered 1..n. Display names are only ever exposed here.
-- ---------------------------------------------------------------------------------------------------
create function public.board_rows(p_league uuid)
returns table (pos int, global_rank int, user_id uuid, display_name text, points int, exact_sets int)
language sql stable security definer
set search_path = public
as $$
  select case when p_league is null then s.rank
              else (row_number() over (order by s.rank nulls last, pr.created_at, s.user_id))::int end,
         s.rank, s.user_id, pr.display_name, s.points, s.exact_sets
    from public.standings s
    join public.profiles pr on pr.user_id = s.user_id
   where p_league is null
      or s.user_id in (select lm.user_id from public.league_members lm where lm.league_id = p_league)
$$;
revoke all on function public.board_rows(uuid) from public, anon, authenticated;

create function public.assert_board_access(p_league uuid) returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_league is not null and not exists (
    select 1 from public.league_members where league_id = p_league and user_id = auth.uid()
  ) then
    raise exception 'not_a_member';
  end if;
end;
$$;
revoke all on function public.assert_board_access(uuid) from public, anon, authenticated;

create function public.get_leaderboard(p_league uuid default null, p_offset int default 0, p_limit int default 50)
returns table (pos int, global_rank int, user_id uuid, display_name text, points int, exact_sets int,
               is_me boolean, total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_board_access(p_league);
  if p_league is null then
    -- Global: walk the rank index, never sort 100,000 rows for one page. Accounts created since the
    -- last settlement have no rank yet and appear after the next one.
    return query
      select s.rank, s.rank, s.user_id, pr.display_name, s.points, s.exact_sets, s.user_id = auth.uid(),
             (select count(*)::int from public.standings x where x.rank is not null)
        from public.standings s join public.profiles pr on pr.user_id = s.user_id
       where s.rank is not null
       order by s.rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit least(greatest(coalesce(p_limit, 50), 1), 100);
  else
    return query
      select b.pos, b.global_rank, b.user_id, b.display_name, b.points, b.exact_sets,
             b.user_id = auth.uid(),
             (select count(*)::int from public.league_members lm where lm.league_id = p_league)
        from public.board_rows(p_league) b
       order by b.pos, b.user_id
       offset greatest(coalesce(p_offset, 0), 0)
       limit least(greatest(coalesce(p_limit, 50), 1), 100);
  end if;
end;
$$;

-- "My rank ± radius".
create function public.get_rank_window(p_league uuid default null, p_radius int default 5)
returns table (pos int, global_rank int, user_id uuid, display_name text, points int, exact_sets int,
               is_me boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_radius int := least(greatest(coalesce(p_radius, 5), 1), 25);
  v_mine   int;
begin
  perform public.assert_board_access(p_league);
  if p_league is null then
    select s.rank into v_mine from public.standings s where s.user_id = auth.uid();
    if v_mine is null then return; end if;
    -- the global board is indexed on rank, so this reads at most 2·radius + 1 rows
    return query
      select s.rank, s.rank, s.user_id, pr.display_name, s.points, s.exact_sets, s.user_id = auth.uid()
        from public.standings s join public.profiles pr on pr.user_id = s.user_id
       where s.rank between v_mine - v_radius and v_mine + v_radius
       order by s.rank;
  else
    return query
      with b as (select * from public.board_rows(p_league))
      select b.pos, b.global_rank, b.user_id, b.display_name, b.points, b.exact_sets, b.user_id = auth.uid()
        from b
       where b.pos between (select x.pos from b x where x.user_id = auth.uid()) - v_radius
                       and (select x.pos from b x where x.user_id = auth.uid()) + v_radius
       order by b.pos;
  end if;
end;
$$;

-- A league's picks for one match, with names. Nothing before the match starts.
create function public.get_league_picks(p_league uuid, p_match int)
returns table (user_id uuid, display_name text, winner_id text, sets int, set_scores jsonb,
               pts_winner int, pts_sets int, pts_exact int, pts_total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_league is null then raise exception 'league_required'; end if;
  perform public.assert_board_access(p_league);
  if not exists (select 1 from public.matches m
                  where m.match_no = p_match and m.starts_at is not null
                    and m.starts_at <= public.app_now()) then
    return;
  end if;
  return query
    select p.user_id, pr.display_name, p.winner_id, p.sets, p.set_scores,
           p.pts_winner, p.pts_sets, p.pts_exact, p.pts_total
      from public.picks p
      join public.league_members lm on lm.user_id = p.user_id and lm.league_id = p_league
      join public.profiles pr on pr.user_id = p.user_id
     where p.match_no = p_match;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_league(text)', 'join_league(text)', 'leave_league(uuid)', 'remove_member(uuid, uuid)',
    'delete_league(uuid)', 'my_leagues()', 'update_profile(text, text)',
    'update_consents(boolean, boolean, text)', 'delete_account()',
    'get_leaderboard(uuid, int, int)', 'get_rank_window(uuid, int)', 'get_league_picks(uuid, int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
