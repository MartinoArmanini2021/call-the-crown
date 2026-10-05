-- =====================================================================================================
-- The bragging-rights funnel (brief "bragging rights", Phase 6). Read-only: one select, run it in the SQL
-- editor (or `bunx supabase db query --local -f supabase/queries/funnel.sql`).
-- Counts accounts created since event_config.launch_at, leaving out test and staff accounts
-- (profiles.is_test, profiles.is_staff, as billing_report does). Every percentage has one decimal.
--   signups              accounts created since launch
--   pct_with_pick        … with at least one pick
--   pct_in_league_2plus  … in a league with at least 2 members
--   pct_in_crew          … in a crew-eligible league (league_limits.crew_min_members+, not hidden)
--   pct_reminders_on     … whose latest "reminders" consent is yes
-- =====================================================================================================
with cfg as (
  -- an instance without launch_at set counts every account
  select coalesce(launch_at, '-infinity'::timestamptz) as launch_at,
         coalesce((league_limits->>'crew_min_members')::int, 5) as crew_min
    from public.event_config
),
fans as (
  select u.id
    from auth.users u
    join public.profiles p on p.user_id = u.id
   cross join cfg
   where u.created_at >= cfg.launch_at
     and not p.is_test
     and not p.is_staff
),
league_size as (
  select l.id, l.crew_hidden, count(m.user_id) as members
    from public.leagues l
    join public.league_members m on m.league_id = l.id
   group by l.id, l.crew_hidden
),
per_fan as (
  select f.id,
         exists (select 1 from public.picks k where k.user_id = f.id) as has_pick,
         exists (select 1 from public.league_members m join league_size s on s.id = m.league_id
                  where m.user_id = f.id and s.members >= 2) as in_league,
         exists (select 1 from public.league_members m join league_size s on s.id = m.league_id
                  cross join cfg
                  where m.user_id = f.id and s.members >= cfg.crew_min and not s.crew_hidden) as in_crew,
         coalesce((select c.granted from public.consents c
                    where c.user_id = f.id and c.party = 'reminders'
                    order by c.changed_at desc limit 1), false) as reminders_on
    from fans f
)
select count(*)                                                                    as signups,
       round(100.0 * count(*) filter (where has_pick)     / nullif(count(*), 0), 1) as pct_with_pick,
       round(100.0 * count(*) filter (where in_league)    / nullif(count(*), 0), 1) as pct_in_league_2plus,
       round(100.0 * count(*) filter (where in_crew)      / nullif(count(*), 0), 1) as pct_in_crew,
       round(100.0 * count(*) filter (where reminders_on) / nullif(count(*), 0), 1) as pct_reminders_on
  from per_fan;
