/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// O6: where do ops_alerts and watchdog findings go? watchdog() (0009) runs watchdog_check() and then
// posts every unsent alert to the Vault secret "ops_webhook" through pg_net, and returns quietly when
// the secret is missing. Nothing in the app reads ops_alerts (no screen, no other job).
// PGlite: the test shim records net.http_post calls in net.calls, so delivery attempts are observable.
// Night 1 scenario: the 2026 article still does not exist at 18:00 UTC on 21 Oct (QF1 under way).
import { describe, expect, it } from "bun:test";
import { apiMissing, freshEvent } from "./lib";

const night1NoPage = async () => {
  const ev = await freshEvent();
  ev.wiki.set(() => apiMissing());
  await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:02:00Z");
  return ev;
};
const posts = async (ev: Awaited<ReturnType<typeof freshEvent>>) =>
  (await ev.db.query<{ url: string; body: any }>("select url, body from net.calls order by id"))
    .rows;

describe("O6 alert delivery", () => {
  it("night 1, no article: with ops_webhook set, the watchdog posts poller_unhealthy to the webhook (fail safe works)", async () => {
    const ev = await night1NoPage();
    await ev.db.query(
      "insert into vault.decrypted_secrets values ('ops_webhook', 'https://discord.example.test/api/webhooks/1/x')",
    );
    await ev.db.query("select public.watchdog()");
    const p = await posts(ev);
    expect(p.length).toBe(1);
    expect(p[0]!.body.content).toContain("poller_unhealthy");
    expect(p[0]!.body.content).toContain("wikipedia answered 404"); // the reason ("page does not exist yet") is in result_log only
    expect(
      await ev.db
        .query("select 1 from public.matches where status <> 'scheduled'")
        .then((r) => r.rows.length),
    ).toBe(0);
    await ev.db.close();
  }, 60_000);

  it("BUG: without ops_webhook, the same alert goes nowhere, and nothing anywhere records that alerts cannot be delivered", async () => {
    const ev = await night1NoPage();
    await ev.db.query("select public.watchdog()");
    const p = await posts(ev);
    const unsent = (
      await ev.db.query<{ n: number }>(
        "select count(*)::int as n from public.ops_alerts where sent_at is null",
      )
    ).rows[0]!.n;
    const anySignal = (
      await ev.db.query<{ n: number }>(
        "select count(*)::int as n from public.ops_health where key <> 'poll-results' and not ok",
      )
    ).rows[0]!.n;
    await ev.db.close();
    expect(unsent).toBeGreaterThan(0); // the alert exists, in a table nobody reads
    // today: posts = 0 and nothing says so; fixed = the failure is recorded (and, with ops_deadman, reported off-box)
    expect({ posts: p.length, deliveryProblemRecorded: anySignal > 0 }).toEqual({
      posts: 0,
      deliveryProblemRecorded: true,
    });
  }, 60_000);

  it("BUG (S-09 + Discord rate limit): a burst of alerts is posted as one request per alert in the same instant, each marked sent before any answer", async () => {
    const ev = await freshEvent();
    await ev.db.query(
      "insert into vault.decrypted_secrets values ('ops_webhook', 'https://discord.example.test/api/webhooks/1/x')",
    );
    await ev.db.query(
      "insert into public.ops_alerts (kind, detail) select 'result_rejected', jsonb_build_object('match_no', n) from generate_series(1, 8) n",
    );
    await ev.db.query("select public.watchdog()");
    const p = await posts(ev);
    const marked = (
      await ev.db.query<{ n: number }>(
        "select count(*)::int as n from public.ops_alerts where sent_at is not null",
      )
    ).rows[0]!.n;
    await ev.db.close();
    // Discord webhooks allow ~5 requests per 2 s; requests beyond that answer 429 and, being already
    // marked sent, are never retried. One message per run (or a check of the pg_net response) avoids it.
    expect({ marked, posts: p.length }).toEqual({ marked: 8, posts: 1 });
  }, 60_000);

  it("BUG S-09: an alert whose post the webhook refused (HTTP 429) is never sent again", async () => {
    const ev = await freshEvent();
    // pg_net records each answer in net._http_response (id = the request id); the PGlite shim does not
    await ev.db.exec(
      "create table net._http_response (id bigint primary key, status_code int, content text, timed_out boolean, error_msg text, created timestamptz default now())",
    );
    await ev.db.query(
      "insert into vault.decrypted_secrets values ('ops_webhook', 'https://discord.example.test/api/webhooks/1/x')",
    );
    await ev.db.query(
      "insert into public.ops_alerts (kind, detail) values ('result_changed', '{\"match_no\": 3}')",
    );
    await ev.db.query("select public.watchdog()");
    const first = await posts(ev);
    expect(first.length).toBe(1);
    await ev.db.query(
      "insert into net._http_response (id, status_code, content) select max(id), 429, 'rate limited' from net.calls",
    );
    await ev.db.query("select public.watchdog()");
    const all = await posts(ev);
    await ev.db.close();
    expect(all.length).toBe(2);
    expect(all[1]!.body.content).toContain("result_changed");
  }, 60_000);
});
