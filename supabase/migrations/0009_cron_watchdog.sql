-- =====================================================================================================
-- 0009 — the two scheduled jobs: the results poller and the watchdog.
-- Secrets live in Vault, by name, never in the job text (lesson from tennis-fantasy: a pasted key in a
-- cron froze the pipeline for 12 hours with no alert). Create them once per instance (README):
--   select vault.create_secret('<functions base url>', 'functions_url');   e.g. https://<ref>.supabase.co/functions/v1
--   select vault.create_secret('<service role key>',  'service_role_key');
--   select vault.create_secret('<webhook url>',        'ops_webhook');      -- Discord or Slack
-- Patterns from tennis-fantasy/supabase/vault_setup.sql, setup_ingest_cron.sql and the watchdog in
-- 2026-09-22_standings_drift.sql.
-- =====================================================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;   -- not public (advisor lint 0014)

-- Runs the checks, then posts every unsent alert to the ops webhook. Quiet when no webhook is set.
create function public.watchdog() returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_webhook text;
  v_text    text;
  r         record;
begin
  perform public.watchdog_check();
  select decrypted_secret into v_webhook from vault.decrypted_secrets where name = 'ops_webhook';
  if v_webhook is null then return; end if;
  for r in select id, kind, detail from public.ops_alerts where sent_at is null order by id limit 20 loop
    v_text := format('[%s] %s %s', (select name from public.event_config), r.kind, r.detail::text);
    -- "content" is what Discord reads, "text" is what Slack reads
    perform net.http_post(url := v_webhook, body := jsonb_build_object('content', v_text, 'text', v_text));
    update public.ops_alerts set sent_at = clock_timestamp() where id = r.id;
  end loop;
end;
$$;
revoke all on function public.watchdog() from public, anon, authenticated, service_role;

-- Calls the poller. The poller itself decides whether a match is in its window; outside every window it
-- returns without touching the provider.
create function public.kick_poller() returns void
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
    url := v_url || '/poll-results',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
end;
$$;
revoke all on function public.kick_poller() from public, anon, authenticated, service_role;

select cron.schedule('poll-results', '* * * * *',   $$select public.kick_poller();$$);
select cron.schedule('watchdog',     '*/5 * * * *', $$select public.watchdog();$$);
