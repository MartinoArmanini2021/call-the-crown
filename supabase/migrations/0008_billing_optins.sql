-- =====================================================================================================
-- 0008 — the billing metric and the opt-in lists. Service role only.
-- Qualified fan = an account on this instance, email-verified, not flagged staff or test, that made or
-- changed a pick on 2 or more distinct Riyadh days between launch and the billing close.
-- The source is activity_days, written inside save_pick. PostHog is never a billing source.
-- =====================================================================================================

create function public.billing_report() returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  c      public.event_config%rowtype;
  v_from date;
  v_to   date;
  v_out  jsonb;
begin
  select * into c from public.event_config;
  v_from := (c.launch_at at time zone c.timezone)::date;
  v_to   := (c.billing_close_at at time zone c.timezone)::date;

  select jsonb_build_object(
           'event', c.name,
           'timezone', c.timezone,
           'window_from', v_from,
           'window_to', v_to,
           'generated_at', clock_timestamp(),
           'registered', count(*),
           'verified', count(*) filter (where t.verified),
           'qualified', count(*) filter (where t.verified and t.days >= 2),
           'excluded_staff_or_test', (select count(*) from public.profiles where is_staff or is_test))
    into v_out
    from (
      select pr.user_id,
             u.email_confirmed_at is not null as verified,
             (select count(*) from public.activity_days a
               where a.user_id = pr.user_id
                 and (v_from is null or a.day >= v_from) and (v_to is null or a.day <= v_to)) as days
        from public.profiles pr
        join auth.users u on u.id = pr.user_id
       where not pr.is_staff and not pr.is_test
    ) t;
  return v_out;
end;
$$;

-- Freezes the report at event close, with a hash of exactly what was stored.
create function public.snapshot_billing() returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_report jsonb := public.billing_report();
begin
  insert into public.billing_snapshots (report, sha256)
  values (v_report, encode(sha256(convert_to(v_report::text, 'UTF8')), 'hex'));
  return v_report;
end;
$$;

-- One party's opted-in list: the latest answer per account is the one that counts. Only verified
-- addresses, and never test accounts: an unverified address may not belong to the person who typed it.
create function public.export_optins(p_party text)
returns table (email text, display_name text, consented_at timestamptz, text_version text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_party is null or p_party not in ('organiser', 'gsgm') then raise exception 'bad_party'; end if;
  return query
    select u.email::text, pr.display_name, c.changed_at, c.text_version
      from (select distinct on (x.user_id) x.user_id, x.granted, x.changed_at, x.text_version
              from public.consents x where x.party = p_party
             order by x.user_id, x.changed_at desc) c
      join auth.users u on u.id = c.user_id
      join public.profiles pr on pr.user_id = c.user_id
     where c.granted and u.email_confirmed_at is not null and not pr.is_test
     order by c.changed_at;
end;
$$;

revoke all on function public.billing_report()    from public, anon, authenticated;
revoke all on function public.snapshot_billing()  from public, anon, authenticated;
revoke all on function public.export_optins(text) from public, anon, authenticated;
grant execute on function public.billing_report()    to service_role;
grant execute on function public.snapshot_billing()  to service_role;
grant execute on function public.export_optins(text) to service_role;
