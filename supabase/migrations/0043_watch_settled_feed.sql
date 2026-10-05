-- =====================================================================================================
-- 0043 - the watchdog also watches a feed that has gone bad AFTER a match settled (audit 5-6 Oct 2026,
-- finding S-10; applied on Tino's word, 6 Oct 2026).
-- watchdog_check (0007) demands a healthy poller only while a match is scheduled and in its window. The
-- poller keeps re-reading a settled match for 12 hours to catch corrections; if the page is blanked or
-- the result vanishes in that time the heartbeat turns unhealthy (poll.ts) but nobody is told once the
-- night's matches are all settled. Now the same check also runs while any settled match is still
-- watched (12 hours, as poll-results/due.ts WATCH_AFTER_SETTLE_MS).
-- Body identical to 0007 except the window condition.
-- =====================================================================================================
create or replace function public.watchdog_check() returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.app_now();
  v_new int := 0;
  r     record;
  h     public.ops_health%rowtype;
begin
  -- a match more than 4 hours past its start with no final result
  for r in select match_no, starts_at from public.matches
            where status = 'scheduled' and starts_at is not null and starts_at < v_now - interval '4 hours' loop
    if not exists (select 1 from public.ops_alerts a
                    where a.kind = 'result_overdue' and (a.detail->>'match_no')::int = r.match_no
                      and a.at > clock_timestamp() - interval '1 hour') then
      insert into public.ops_alerts (kind, detail) values ('result_overdue',
        jsonb_build_object('match_no', r.match_no, 'starts_at', r.starts_at));
      v_new := v_new + 1;
    end if;
  end loop;

  -- during a match window (start − 15 min until settled), and while a settled match is still watched
  -- for corrections (12 hours), the poller must be alive and healthy
  if exists (select 1 from public.matches
              where (status = 'scheduled' and starts_at is not null and starts_at - interval '15 minutes' <= v_now)
                 or (status <> 'scheduled' and settled_at is not null and settled_at > v_now - interval '12 hours')) then
    select * into h from public.ops_health where key = 'poll-results';
    if (not found or not h.ok or h.at < clock_timestamp() - interval '5 minutes')
       and not exists (select 1 from public.ops_alerts a
                        where a.kind = 'poller_unhealthy' and a.at > clock_timestamp() - interval '1 hour') then
      insert into public.ops_alerts (kind, detail) values ('poller_unhealthy',
        jsonb_build_object('ok', h.ok, 'detail', h.detail, 'last_seen', h.at));
      v_new := v_new + 1;
    end if;
  end if;
  return v_new;
end;
$$;
revoke all on function public.watchdog_check() from public, anon, authenticated;
grant execute on function public.watchdog_check() to service_role;
