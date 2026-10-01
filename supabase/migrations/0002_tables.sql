-- =====================================================================================================
-- 0002 — tables
-- One event per instance: event_config is a single row and no table carries an event id.
-- =====================================================================================================

-- The event: rules, brand, prizes, texts. Public to read. Written by the operator (service role) from an
-- event file (see README, "Set up an event"). No personal data and no secrets live here.
create table public.event_config (
  id                 boolean primary key default true check (id),   -- exactly one row
  name               text        not null,
  timezone           text        not null default 'Asia/Riyadh',
  launch_at          timestamptz,              -- billing window opens
  billing_close_at   timestamptz,              -- billing window closes (24 Oct 23:59 Riyadh for 2026)
  rank_snapshot_date date,                     -- the published date of the ranks used for the upset bonus
  rules              jsonb       not null,     -- every rule constant; see supabase/events/example_event.sql
  league_limits      jsonb       not null default '{"max_leagues_per_user": 10, "max_members": 200}',
  branding           jsonb       not null default '{}',
  prizes             jsonb       not null default '[]',
  prize_terms_url    text,
  privacy            jsonb       not null default '{}',   -- notice + consent texts with their versions
  sponsor_slots      jsonb       not null default '[]',
  flags              jsonb       not null default '{}',   -- e.g. {"arabic": false}
  updated_at         timestamptz not null default now(),
  constraint rules_shape check (
    rules ? 'winner_points' and rules ? 'sets_points' and rules ? 'per_set_exact'
    and rules ? 'upset_constant' and rules ? 'allowed_set_scores' and rules ? 'deciding_set'
  )
);

create table public.players (
  id            text primary key,
  name          text not null,
  name_ar       text,
  country       text,            -- IOC code
  seed          int,
  rank_snapshot int  not null,   -- feeds the upset bonus; fixed once play starts
  image_path    text             -- organiser-supplied image in storage; null shows initials
);

-- The bracket. A slot's source says where its player comes from:
--   {"type": "player", "id": "p1"} | {"type": "winner", "match": 1} | {"type": "loser", "match": 3}
-- Result columns (status, winner_id, set_scores, settled_at, result_rev) change only inside settlement:
-- a trigger in 0006 refuses every other write to them.
create table public.matches (
  match_no             int  primary key,
  round                text not null check (round in ('QF', 'SF', '3P', 'F')),
  p1_source            jsonb not null,
  p2_source            jsonb not null,
  p1_id                text references public.players (id),
  p2_id                text references public.players (id),
  starts_at            timestamptz,     -- the lock
  p1_win_points        int,             -- winner points a correct pick on p1 would earn (upset bonus included)
  p2_win_points        int,
  status               text not null default 'scheduled'
                       check (status in ('scheduled', 'completed', 'retired', 'walkover')),
  winner_id            text references public.players (id),
  set_scores           jsonb,           -- ordered [{p1_games, p2_games}], player 1's games first
  settled_at           timestamptz,
  result_rev           int  not null default 0,
  settlement_paused    boolean not null default false,
  refetch_requested_at timestamptz,
  constraint winner_in_pair check (winner_id is null or winner_id in (p1_id, p2_id)),
  constraint result_complete check ((status = 'scheduled') = (winner_id is null))
);

create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  display_name    text,
  locale          text not null default 'en' check (locale in ('en', 'ar')),
  is_staff        boolean not null default false,   -- excluded from billing; set by the operator only
  is_test         boolean not null default false,
  join_fail_count int not null default 0,           -- wrong league codes in the current window
  join_fail_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table public.picks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  match_no   int  not null references public.matches (match_no),
  winner_id  text not null references public.players (id),
  sets       int  not null check (sets in (2, 3)),
  set_scores jsonb not null,           -- ordered [{p1_games, p2_games}] in the match's player order
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the stored breakdown, written by settlement only; null until the match is settled
  pts_winner int,
  pts_sets   int,
  pts_exact  int,
  exact_sets int,
  pts_total  int,
  scored_rev int,
  primary key (user_id, match_no)
);
create index picks_match_idx on public.picks (match_no);

-- Append-only consent history; the current state is the latest row per (user, party).
create table public.consents (
  user_id      uuid not null references auth.users (id) on delete cascade,
  party        text not null check (party in ('organiser', 'gsgm')),
  granted      boolean not null,
  text_version text not null,
  changed_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, party, changed_at)
);

create table public.leagues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  code       text not null unique,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index leagues_owner_idx on public.leagues (owner_id);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key (league_id, user_id)
);
create index league_members_user_idx on public.league_members (user_id);

-- The global league. One row per account, strict rank for everyone, rebuilt by settlement.
create table public.standings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  points          int not null default 0,
  exact_sets      int not null default 0,
  final_games_gap int,            -- |games in the predicted final − games in the real final|; null = no call
  final_pick_at   timestamptz,    -- last change to the pick on the final
  rank            int,            -- null until the first settlement after sign-up
  updated_at      timestamptz not null default now()
);
create index standings_rank_idx on public.standings (rank);

-- The billing record: one row per account per Riyadh day on which a pick was made or changed.
create table public.activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

-- Every payload the results provider ever gave us, and what we did with it. Append-only (trigger in 0007).
create table public.result_log (
  id          bigint generated always as identity primary key,
  match_no    int,
  provider    text not null,
  fetched_at  timestamptz not null default clock_timestamp(),
  http_status int,
  raw         jsonb,
  raw_sha256  text,
  normalised  jsonb,
  outcome     text not null,
  diff        jsonb,
  note        text
);
create index result_log_match_idx on public.result_log (match_no, id);

-- Provider ids → ours.
create table public.provider_map (
  provider     text not null,
  kind         text not null check (kind in ('match', 'player')),
  provider_ref text not null,
  our_ref      text not null,
  primary key (provider, kind, provider_ref)
);

-- Beyond the brief's list (see the plan): the frozen billing report, the poller's heartbeat, and the
-- queue of operator alerts.
create table public.billing_snapshots (
  id       bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  report   jsonb not null,
  sha256   text  not null
);

create table public.ops_health (
  key    text primary key,
  ok     boolean not null,
  detail text,
  at     timestamptz not null default now()
);

create table public.ops_alerts (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default clock_timestamp(),
  kind    text not null,
  detail  jsonb not null default '{}',
  sent_at timestamptz
);
