-- =====================================================================================================
-- 0003 — row level security, grants, policies
-- anon: SELECT on public event data only. authenticated: SELECT where a policy allows; no direct
-- INSERT, UPDATE or DELETE anywhere. Every write goes through an RPC (0005–0008).
-- =====================================================================================================

alter table public.event_config      enable row level security;
alter table public.players           enable row level security;
alter table public.matches           enable row level security;
alter table public.picks             enable row level security;
alter table public.profiles          enable row level security;
alter table public.consents          enable row level security;
alter table public.leagues           enable row level security;
alter table public.league_members    enable row level security;
alter table public.standings         enable row level security;
alter table public.activity_days     enable row level security;
alter table public.result_log        enable row level security;
alter table public.provider_map      enable row level security;
alter table public.billing_snapshots enable row level security;
alter table public.ops_health        enable row level security;
alter table public.ops_alerts        enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- Public event data
grant select on public.event_config, public.players, public.matches to anon, authenticated;
create policy "event config is public" on public.event_config for select to anon, authenticated using (true);
create policy "players are public"     on public.players      for select to anon, authenticated using (true);
create policy "matches are public"     on public.matches      for select to anon, authenticated using (true);

-- Picks: yours always; everyone's once that match has started.
-- Pattern from tennis-fantasy/supabase/2026-09-24_six_kings_picks.sql.
grant select on public.picks to authenticated;
create policy "picks: own, or the match has started" on public.picks for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.matches m
                where m.match_no = picks.match_no
                  and m.starts_at is not null and m.starts_at <= public.app_now())
  );

-- Profiles and consents: own rows only. Display names reach other fans only through the board RPCs.
grant select on public.profiles, public.consents to authenticated;
create policy "profiles: own row"  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "consents: own rows" on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

-- Leagues: the ones I belong to. The helper is SECURITY DEFINER so the policy on league_members does
-- not have to read league_members under its own policy (error 42P17, infinite recursion).
-- Pattern from tennis-fantasy/supabase/fix_rls_recursion.sql.
create function public.my_league_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$ select league_id from public.league_members where user_id = auth.uid() $$;
revoke all on function public.my_league_ids() from public, anon;
grant execute on function public.my_league_ids() to authenticated;

grant select on public.leagues, public.league_members to authenticated;
create policy "leagues: mine" on public.leagues for select to authenticated
  using (id in (select public.my_league_ids()));
create policy "league members: of my leagues" on public.league_members for select to authenticated
  using (league_id in (select public.my_league_ids()));

-- standings, activity_days, result_log, provider_map, billing_snapshots, ops_health, ops_alerts:
-- RLS on, no policy, no grant. Nothing reaches them from the client except through an RPC.

-- The operator (service role): reads everything; writes directly only to configuration. Players, the
-- bracket, start times and results have their own RPCs; results have no direct path at all.
revoke all on all tables in schema public from service_role;
grant select on all tables in schema public to service_role;
grant insert, update, delete on public.event_config, public.provider_map to service_role;
grant update (is_staff, is_test) on public.profiles to service_role;
