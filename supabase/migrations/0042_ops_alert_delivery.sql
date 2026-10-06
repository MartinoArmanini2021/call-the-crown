-- =====================================================================================================
-- 0042 - alerts that actually arrive (audit 5-6 Oct 2026, finding O6; applied on Tino's word, 6 Oct 2026).
-- 0009's watchdog() returns quietly when the Vault secret ops_webhook is missing, posts one request per
-- alert in the same instant (Discord answers 429 beyond ~5 per 2 s) and marks each alert sent when the
-- request is queued, so a failed post is never retried (audit S-09). Nothing in the app reads
-- ops_alerts, so in any of those cases a broken feed on match night goes unnoticed.
-- Now:
--   · no webhook: recorded as an unhealthy 'watchdog' row in ops_health, and reported to the optional
--     dead-man's switch (below), never silent;
--   · one message per run with every unsent alert (Discord limit 2,000 characters: cut at 1,900);
--   · an alert counts as sent only once the webhook answered 2xx: a failed or timed-out post is
--     queued again on the next run (pg_net keeps its responses for 6 hours);
--   · optional Vault secret ops_deadman (e.g. a healthchecks.io ping URL): pinged every run, with /fail
--     when alerts cannot be delivered. If the database, pg_cron or the watchdog itself dies, the pings
--     stop and that service emails the operator: the one alarm that does not depend on this database.
-- Set the secrets once per instance (README):
--   select vault.create_secret('<discord webhook url>', 'ops_webhook');
--   select vault.create_secret('https://hc-ping.com/<uuid>', 'ops_deadman');   -- optional, recommended
-- =====================================================================================================
alter table public.ops_alerts add column net_request_id bigint;

create or replace function public.watchdog() returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_webhook text;
  v_deadman text;
  v_text    text;
  v_ids     bigint[];
  v_unsent  int;
  v_req     bigint;
  v_failed  int := 0;
begin
  perform public.watchdog_check();
  select decrypted_secret into v_webhook from vault.decrypted_secrets where name = 'ops_webhook';
  select decrypted_secret into v_deadman from vault.decrypted_secrets where name = 'ops_deadman';

  -- a post the webhook refused or never answered goes back in the queue
  if to_regclass('net._http_response') is not null then
    execute $q$
      update public.ops_alerts a set sent_at = null, net_request_id = null
        from net._http_response r
       where a.net_request_id = r.id and a.sent_at is not null
         and (r.status_code is null or r.status_code not between 200 and 299)$q$;
    get diagnostics v_failed = row_count;
  end if;

  select count(*) into v_unsent from public.ops_alerts where sent_at is null;
  if v_webhook is null then
    insert into public.ops_health (key, ok, detail, at)
    values ('watchdog', false, format('ops_webhook is not set: %s alert(s) not delivered', v_unsent), clock_timestamp())
    on conflict (key) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
    if v_deadman is not null then perform net.http_get(url := v_deadman || '/fail'); end if;
    return;
  end if;

  select array_agg(id order by id), string_agg(format('• %s %s', kind, detail::text), E'\n' order by id)
    into v_ids, v_text
    from (select id, kind, detail from public.ops_alerts where sent_at is null order by id limit 20) x;
  if v_ids is not null then
    v_text := left(format('[%s] %s alert(s)%s', (select name from public.event_config), v_unsent,
                          case when v_unsent > 20 then ' (first 20)' else '' end) || E'\n' || v_text, 1900);
    -- "content" is what Discord reads, "text" is what Slack reads
    v_req := net.http_post(url := v_webhook, body := jsonb_build_object('content', v_text, 'text', v_text));
    update public.ops_alerts set sent_at = clock_timestamp(), net_request_id = v_req where id = any (v_ids);
  end if;

  insert into public.ops_health (key, ok, detail, at)
  values ('watchdog', v_failed = 0,
          format('%s alert(s) posted; %s earlier post(s) refused by the webhook, re-sent', coalesce(cardinality(v_ids), 0), v_failed),
          clock_timestamp())
  on conflict (key) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
  if v_deadman is not null then
    perform net.http_get(url := v_deadman || case when v_failed = 0 then '' else '/fail' end);
  end if;
end;
$$;
revoke all on function public.watchdog() from public, anon, authenticated, service_role;
