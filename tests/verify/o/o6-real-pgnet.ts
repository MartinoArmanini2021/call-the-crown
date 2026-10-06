// O6 fix (0042) on the REAL local stack with real pg_net: a post the webhook never answers is queued
// again, and a missing webhook is recorded, never silent. The webhook points at a local port where
// nothing listens, so the post fails and nothing leaves the machine. Leaves no alert or secret behind.
//   bun tests/verify/o/o6-real-pgnet.ts
import { SQL } from "bun";

const sql = new SQL({ url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok: boolean, text: string, got?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${text}${ok ? "" : `  got: ${JSON.stringify(got)}`}`);
  if (!ok) failed = true;
};
try {
  await sql`delete from vault.secrets where name in ('ops_webhook', 'ops_deadman')`;
  const [{ id }] =
    await sql`insert into public.ops_alerts (kind, detail) values ('audit_o6_test', '{"n": 1}') returning id`;

  // 1. no webhook: nothing posted, the watchdog records itself unhealthy
  await sql`select public.watchdog()`;
  const [h1] = await sql`select ok, detail from public.ops_health where key = 'watchdog'`;
  check(
    h1?.ok === false && /ops_webhook is not set/.test(h1.detail),
    "no webhook: ops_health watchdog row is unhealthy",
    h1,
  );
  const [a1] = await sql`select sent_at, net_request_id from public.ops_alerts where id = ${id}`;
  check(a1.sent_at === null, "no webhook: the alert stays unsent", a1);

  // 2. a webhook that never answers (nothing listens on that port)
  await sql`select vault.create_secret('http://127.0.0.1:59999/webhook', 'ops_webhook')`;
  await sql`select public.watchdog()`;
  const [a2] = await sql`select sent_at, net_request_id from public.ops_alerts where id = ${id}`;
  check(
    a2.sent_at !== null && a2.net_request_id !== null,
    "webhook set: the alert is posted, with its pg_net request id",
    a2,
  );
  let resp: { status_code: number | null; error_msg: string | null } | undefined;
  for (let i = 0; i < 30 && !resp; i++) {
    await sleep(1000);
    [resp] =
      await sql`select status_code, error_msg from net._http_response where id = ${a2.net_request_id}`;
  }
  check(!!resp && resp.status_code === null, "pg_net recorded the failed post", resp);

  // 3. the next run queues it again and posts it again
  await sql`select public.watchdog()`;
  const [a3] = await sql`select sent_at, net_request_id from public.ops_alerts where id = ${id}`;
  check(
    a3.net_request_id !== null && a3.net_request_id !== a2.net_request_id,
    "next run: the refused alert is posted again",
    a3,
  );
  const [h3] = await sql`select ok, detail from public.ops_health where key = 'watchdog'`;
  check(
    h3?.ok === false && /refused by the webhook, re-sent/.test(h3.detail),
    "next run: ops_health says the earlier post was refused",
    h3,
  );
} finally {
  await sql`delete from public.ops_alerts where kind = 'audit_o6_test'`;
  await sql`delete from vault.secrets where name = 'ops_webhook'`;
  await sql`delete from public.ops_health where key = 'watchdog'`;
  await sql.close();
}
if (failed) process.exit(1);
