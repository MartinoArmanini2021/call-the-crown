// P5: every analytics event in the code against what is really sent (audit, 5 Oct 2026). One tab,
// client-side navigation, and a pause after each action so posthog-js flushes before anything reloads.
// PostHog is fulfilled locally (lib.wire); nothing leaves the machine.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/analytics.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API, APP, UA, newLog, passwordSession, pw, signedInInit, sleep, wire } from "./lib";

const U = JSON.parse(readFileSync(path.join(import.meta.dirname, "out-users.json"), "utf8"));
const log = newLog();
const steps: string[] = [];
const mark = (s: string) => steps.push(`${log.posthog.length} ${s}`);
const flush = () => sleep(4000);

async function mailCode(to: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(
      `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`,
    );
    const j = (await r.json()) as { messages?: { ID: string; Created: string }[] };
    const m0 = j.messages?.[0];
    if (m0 && Date.parse(m0.Created) >= after - 2000) {
      const m = (await (await fetch(`http://127.0.0.1:55324/api/v1/message/${m0.ID}`)).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(m.Text)?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error("no code");
}

const browser = await pw.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: UA,
  timezoneId: "Asia/Riyadh",
});
await wire(context, log);
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
await signedInInit(context, await passwordSession(U.users.b.email, U.password), "en");
const p = await context.newPage();
await p.goto(`${APP}/`);
await flush();
mark("bottom tabs + header links");
for (const tab of ["Picks", "Results", "Standings"]) {
  await p.locator("nav.fixed a", { hasText: tab }).click();
  await flush();
}
await p.locator("header a[aria-label='How to play']").click();
await flush();
await p.locator("header a[aria-label='Profile']").click();
await flush();
await p.locator("nav.fixed a", { hasText: "Standings" }).click();
await flush();
mark("league tab + invite");
await p.getByRole("tab", { name: "P audit league" }).click();
await sleep(800);
await p.getByRole("button", { name: "Invite" }).click();
await flush();
const clip = await p
  .evaluate(() => navigator.clipboard.readText())
  .catch((e: unknown) => String(e));
mark("create league");
await p.getByRole("button", { name: "+ League" }).click();
await p.getByLabel("League name").fill("P audit two");
await p.getByRole("button", { name: "Create" }).click();
await flush();
mark("join league (already a member)");
await p.getByRole("button", { name: "+ League" }).click();
await p.getByLabel("6-character code").fill(U.league.code);
await p.getByRole("button", { name: "Join", exact: true }).click();
await flush();
const joinedAgain = await p.locator('[role="status"], [role="alert"]').allInnerTexts();
mark("sign out");
await p.locator("header a[aria-label='Profile']").click();
await sleep(800);
await p.getByRole("button", { name: "Sign out" }).click();
await flush();
mark("sign in with password");
await p.locator("header a", { hasText: "Sign in" }).click();
await sleep(800);
await p.getByRole("tab", { name: "I have an account" }).click();
await p.getByLabel("Email").fill(U.users.b.email);
await p.getByLabel("Password", { exact: true }).fill(U.password);
await p.locator('form button[type="submit"]').click();
await flush();
mark("sign out, then forgot password (code)");
await p.locator("header a[aria-label='Profile']").click();
await sleep(800);
await p.getByRole("button", { name: "Sign out" }).click();
await flush();
await p.locator("header a", { hasText: "Sign in" }).click();
await sleep(800);
await p.getByRole("tab", { name: "I have an account" }).click();
await p.getByRole("button", { name: /Forgot your password/ }).click();
await p.getByLabel("Email").fill(U.users.b.email);
const sentAt = Date.now();
await p.locator('form button[type="submit"]').click();
await p.waitForSelector('input[autocomplete="one-time-code"]');
await p
  .locator('input[autocomplete="one-time-code"]')
  .fill(await mailCode(U.users.b.email, sentAt));
await p.locator('form button[type="submit"]').click();
await p.waitForSelector('input[autocomplete="new-password"]');
await flush();
await p.getByRole("button", { name: "Not now" }).click();
await flush();
mark("join with failing details (join_details_failed)");
await p.locator("header a[aria-label='Profile']").click();
await sleep(800);
await p.getByRole("button", { name: "Sign out" }).click();
await flush();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await context.route(`${API}/rest/v1/rpc/update_profile`, (r: any) =>
  r.fulfill({ status: 500, json: { message: "boom" } }),
);
const email = `p-jf${Date.now() % 100000}@example.test`;
await p.locator("header a", { hasText: "Sign in" }).click();
await sleep(800);
await p.getByLabel("Display name").fill("Jay Fail");
await p.getByLabel("Email").fill(email);
const sent2 = Date.now();
await p.locator('form button[type="submit"]').click();
await p.waitForSelector('input[autocomplete="one-time-code"]');
await p.locator('input[autocomplete="one-time-code"]').fill(await mailCode(email, sent2));
await p.locator('form button[type="submit"]').click();
await p.waitForSelector('input[autocomplete="new-password"]');
await flush();
await sleep(2000);
await browser.close();

const sent = log.posthog.map((e) => ({
  event: e.event,
  name: e.props["name"],
  $pathname: e.props["$pathname"],
  custom: Object.fromEntries(
    Object.entries(e.props).filter(
      ([k]) => !k.startsWith("$") && k !== "token" && k !== "distinct_id",
    ),
  ),
}));
const all = JSON.stringify(log.posthog);
const out = {
  steps,
  sent,
  clipboard: clip,
  joinedAgain,
  screenViewPathMismatch: sent.filter(
    (e) => e.event === "screen_view" && (e.name === "landing" ? "/" : `/${e.name}`) !== e.$pathname,
  ),
  personal: {
    emails: (all.match(/p-[a-z0-9]+@example\.test/g) ?? []).length,
    leagueCode: all.includes(U.league.code),
    displayName: /Bo Audit|Pia Audit|Jay Fail/.test(all),
    ipOrUa: Object.keys(log.posthog[0]?.props ?? {}).filter((k) => /ip|agent|referr|url/i.test(k)),
  },
  console: log.console.filter((x) => !x.url.startsWith("about:")),
  blocked: [...new Set(log.blocked)],
};
writeFileSync(path.join(import.meta.dirname, "out-analytics.json"), JSON.stringify(out, null, 2));
for (const e of sent)
  console.log(
    e.event.padEnd(20),
    String(e.name ?? "").padEnd(12),
    String(e.$pathname).padEnd(12),
    JSON.stringify(e.custom),
  );
console.log(
  JSON.stringify(
    { steps, clip, joinedAgain, personal: out.personal, console: out.console },
    null,
    1,
  ),
);
