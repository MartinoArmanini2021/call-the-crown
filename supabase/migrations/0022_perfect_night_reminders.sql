-- =====================================================================================================
-- 0022 — Perfect Night and night reminders (brief "bragging rights", Phase 5)
--
-- Nights. A night is the date of a match's starts_at in event_config.timezone, numbered 1, 2, 3 in date
-- order (dense rank): 21, 22 and 24 Oct are nights 1, 2 and 3. The app numbers nights the same way
-- (src/lib/callCard.ts nightOf); both are tested on the event's dates. match_nights() is the one
-- definition the badge and the reminders share.
--
-- Perfect Night. get_my_badges(): for each complete night (every match settled), whether the caller
-- picked the winner of every match. A pick saved after the real start is void (0018: it scores 0) and
-- does not count as a called winner.
--
-- Reminders, opt-in only. A third consent party, "reminders" (text version reminders-1), written by
-- set_reminder_optin (update_consents is untouched). reminder_sends logs one row per fan and night:
-- the row is claimed with insert … on conflict do nothing before the email is sent, so two runs at once
-- can never send twice; nothing is ever retried automatically. The edge function send-reminders does
-- the sending; a new pg_cron job "send-reminders" calls it every 5 minutes exactly as kick_poller calls
-- poll-results (0009: Vault secrets, pg_net, the service key). poll-results and watchdog are untouched.
-- The unsubscribe link goes to the edge function reminder-unsubscribe (POST only), which calls
-- unsubscribe_reminders with the user id from a verified HMAC token.
-- =====================================================================================================

-- The consents table accepts the new party (its check constraint only; policies and grants unchanged).
alter table public.consents drop constraint consents_party_check;
alter table public.consents add constraint consents_party_check
  check (party in ('organiser', 'gsgm', 'reminders'));

-- ---------------------------------------------------------------------------------------------------
-- Nights
-- ---------------------------------------------------------------------------------------------------
create function public.match_nights()
returns table (match_no int, night_no int)
language sql stable
set search_path = public
as $$
  select m.match_no,
         (dense_rank() over (order by (m.starts_at at time zone c.timezone)::date))::int
    from public.matches m
   cross join public.event_config c
   where m.starts_at is not null
$$;
revoke all on function public.match_nights() from public, anon, authenticated;

create function public.get_my_badges()
returns table (night_no int, perfect boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  return query
    select n.night_no,
           bool_and(k.user_id is not null
                    and k.winner_id = m.winner_id
                    and coalesce(k.pts_winner, 0) > 0)   -- a void late pick (0018) scores 0
      from public.match_nights() n
      join public.matches m on m.match_no = n.match_no
      left join public.picks k on k.match_no = m.match_no and k.user_id = v_uid
     group by n.night_no
    having bool_and(m.settled_at is not null)
     order by n.night_no;
end;
$$;
revoke all on function public.get_my_badges() from public, anon;
grant execute on function public.get_my_badges() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The reminders consent (the pattern of update_consents: append a row only when the answer changes)
-- ---------------------------------------------------------------------------------------------------
create function public.set_reminder_optin(p_on boolean) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_on is null then raise exception 'consent_incomplete'; end if;
  if p_on is distinct from (
    select c.granted from public.consents c
     where c.user_id = v_uid and c.party = 'reminders' order by c.changed_at desc limit 1
  ) then
    insert into public.consents (user_id, party, granted, text_version)
    values (v_uid, 'reminders', p_on, 'reminders-1');
  end if;
end;
$$;
revoke all on function public.set_reminder_optin(boolean) from public, anon;
grant execute on function public.set_reminder_optin(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The send log
-- ---------------------------------------------------------------------------------------------------
create table public.reminder_sends (
  user_id  uuid not null references auth.users (id) on delete cascade,
  night_no int  not null,
  status   text not null check (status in ('sent', 'failed', 'dry_run')),
  at       timestamptz not null default now(),
  primary key (user_id, night_no)
);
alter table public.reminder_sends enable row level security;
revoke all on public.reminder_sends from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- For the edge function only (service role)
-- ---------------------------------------------------------------------------------------------------

-- Who gets a reminder now: nights whose first match starts within the next 2 hours and has not
-- started; fans whose latest "reminders" consent is true, with a confirmed address, with at least one
-- match that night that has both players, has not started and has no pick from them, and no
-- reminder_sends row for that night yet. With the line for their newest league once they have a rank.
create function public.reminder_candidates()
returns table (user_id uuid, email text, locale text, night_no int, first_start timestamptz,
               open_count int, total_count int,
               league_name text, league_rank int, league_size int)
language sql stable security definer
set search_path = public
as $$
  with nights as (
    select n.night_no, m.match_no, m.starts_at, m.p1_id, m.p2_id
      from public.match_nights() n join public.matches m on m.match_no = n.match_no
  ),
  due as (
    select night_no, min(starts_at) as first_start, count(*)::int as total_count
      from nights group by night_no
    having min(starts_at) > public.app_now() and min(starts_at) <= public.app_now() + interval '2 hours'
  ),
  opted as (
    select distinct on (c.user_id) c.user_id, c.granted
      from public.consents c where c.party = 'reminders'
     order by c.user_id, c.changed_at desc
  ),
  open_per_fan as (
    select o.user_id, d.night_no, d.first_start, d.total_count,
           (select count(*)::int from nights x
             where x.night_no = d.night_no and x.p1_id is not null and x.p2_id is not null
               and x.starts_at > public.app_now()
               and not exists (select 1 from public.picks k
                                where k.user_id = o.user_id and k.match_no = x.match_no)) as open_count
      from opted o cross join due d
     where o.granted
  )
  select f.user_id, u.email::text, coalesce(p.locale, 'en'), f.night_no, f.first_start,
         f.open_count, f.total_count, lg.name, lg.pos, lg.size
    from open_per_fan f
    join auth.users u on u.id = f.user_id and u.email_confirmed_at is not null
    left join public.profiles p on p.user_id = f.user_id
    left join lateral (
      select l.name,
             (select count(*)::int + 1 from public.league_members m2
                join public.standings s2 on s2.user_id = m2.user_id
               where m2.league_id = l.id and s2.rank < s.rank) as pos,
             (select count(*)::int from public.league_members m3 where m3.league_id = l.id) as size
        from public.league_members m
        join public.leagues l on l.id = m.league_id
        join public.standings s on s.user_id = f.user_id
       where m.user_id = f.user_id and s.rank is not null
         and exists (select 1 from public.matches z where z.settled_at is not null)
       order by m.joined_at desc
       limit 1
    ) lg on true
   where f.open_count > 0
     and not exists (select 1 from public.reminder_sends r
                      where r.user_id = f.user_id and r.night_no = f.night_no)
$$;

-- Claim one fan's reminder for one night before anything is sent ("sent", or "dry_run" when no email
-- key is set). True only for the run that claimed it.
create function public.claim_reminder(p_user uuid, p_night int, p_dry_run boolean) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  insert into public.reminder_sends (user_id, night_no, status)
  values (p_user, p_night, case when p_dry_run then 'dry_run' else 'sent' end)
  on conflict (user_id, night_no) do nothing
  returning user_id into v_claimed;
  return v_claimed is not null;
end;
$$;

-- A send that failed: marked failed (never retried) and one ops alert, without personal data.
create function public.reminder_failed(p_user uuid, p_night int, p_detail text) returns void
language sql security definer
set search_path = public
as $$
  update public.reminder_sends set status = 'failed', at = now()
   where user_id = p_user and night_no = p_night;
  insert into public.ops_alerts (kind, detail)
  values ('reminder_failed', jsonb_build_object('night', p_night, 'error', left(p_detail, 300)));
$$;

create function public.reminders_heartbeat(p_ok boolean, p_detail text) returns void
language sql security definer
set search_path = public
as $$
  insert into public.ops_health (key, ok, detail, at)
  values ('send-reminders', p_ok, left(p_detail, 500), clock_timestamp())
  on conflict (key) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at
$$;

-- The unsubscribe link (the edge function has verified the token): reminders off, if they were on.
create function public.unsubscribe_reminders(p_user uuid) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce((select c.granted from public.consents c
                where c.user_id = p_user and c.party = 'reminders'
                order by c.changed_at desc limit 1), false) then
    insert into public.consents (user_id, party, granted, text_version)
    values (p_user, 'reminders', false, 'reminders-1');
    return true;
  end if;
  return false;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'reminder_candidates()', 'claim_reminder(uuid, int, boolean)', 'reminder_failed(uuid, int, text)',
    'reminders_heartbeat(boolean, text)', 'unsubscribe_reminders(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The one new scheduled job: kick send-reminders every 5 minutes, as kick_poller kicks poll-results.
-- ---------------------------------------------------------------------------------------------------
create function public.kick_reminders() returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url || '/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
end;
$$;
revoke all on function public.kick_reminders() from public, anon, authenticated, service_role;

select cron.schedule('send-reminders', '*/5 * * * *', $$select public.kick_reminders();$$);
