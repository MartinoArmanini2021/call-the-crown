-- =====================================================================================================
-- 0052 — the quick vote: "Who takes the crown in Riyadh?" One tap, no sign-up (Tino, 15 Oct 2026: get
-- Call the Crown out there today, while sign-in emails still need the Resend sender).
-- A visitor taps one of the six players. Nothing personal is kept: a random device id from the browser,
-- the player, and a salted hash of the internet address (only to stop ballot-stuffing).
--   - cast_quick_vote(device, player): one vote per device (a second tap changes it); at most 10 new
--     devices per internet address per hour; closed once the first match has started. Callable by anyone
--     (anon), the second and third functions anon may call after app_now.
--   - get_quick_vote_shares(): each player's share of the votes, one decimal, and only from
--     flags.rarity_min_picks (50) votes up, never a count (the same rule as "how fans picked").
-- The player list is fixed here, not read from public.players: the field changed on 6 Oct (Learner Tien
-- replaces Jannik Sinner) and the draw stays frozen while test picks stand.
-- quick_votes: RLS on, no grants; only these two functions touch it.
-- =====================================================================================================

create table public.quick_votes (
  device_id  uuid primary key,
  player_id  text not null check (player_id in ('alcaraz', 'djokovic', 'zverev', 'deminaur', 'fritz', 'tien')),
  ip_hash    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quick_votes_ip_idx on public.quick_votes (ip_hash, created_at);
alter table public.quick_votes enable row level security;
revoke all on public.quick_votes from public, anon, authenticated;

create function public.get_quick_vote_shares()
returns table (player_id text, share numeric(5,1))
language sql stable security definer
set search_path = public
as $$
  with t as (select count(*)::numeric as n from public.quick_votes)
  select v.player_id, round(100.0 * count(*) / t.n, 1)::numeric(5,1)
    from public.quick_votes v cross join t
   where t.n >= coalesce((select (flags->>'rarity_min_picks')::int from public.event_config), 50)
   group by v.player_id, t.n
   order by 2 desc, 1
$$;

create function public.cast_quick_vote(p_device uuid, p_player text)
returns table (player_id text, share numeric(5,1))
language plpgsql security definer
set search_path = public
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip      text  := btrim(split_part(coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-forwarded-for', ''), ',', 1));
  v_hash    text  := case when v_ip <> '' then md5('ctc-quick-vote:' || v_ip) end;
begin
  if p_device is null or p_player is null then raise exception 'vote_incomplete'; end if;
  if p_player not in ('alcaraz', 'djokovic', 'zverev', 'deminaur', 'fritz', 'tien') then
    raise exception 'unknown_player';
  end if;
  if exists (select 1 from public.matches where starts_at is not null and starts_at <= public.app_now()) then
    raise exception 'voting_closed';
  end if;
  if v_hash is not null
     and not exists (select 1 from public.quick_votes q where q.device_id = p_device)
     and (select count(*) from public.quick_votes q
           where q.ip_hash = v_hash and q.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_votes';
  end if;
  insert into public.quick_votes as q (device_id, player_id, ip_hash)
  values (p_device, p_player, v_hash)
  on conflict (device_id) do update set player_id = excluded.player_id, updated_at = now();
  return query select * from public.get_quick_vote_shares();
end;
$$;

revoke all on function public.get_quick_vote_shares() from public;
revoke all on function public.cast_quick_vote(uuid, text) from public;
grant execute on function public.get_quick_vote_shares() to anon, authenticated;
grant execute on function public.cast_quick_vote(uuid, text) to anon, authenticated;
