// P3 deep links after a refresh, P4 time zones, L6 sessions in the browser, P5 analytics click-through
// (audit, 5 Oct 2026). Production build served Pages-style on :5182.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/flows.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  API,
  APP,
  SCREENS,
  UA,
  newLog,
  passwordSession,
  pw,
  signedInInit,
  sleep,
  wire,
} from "./lib";

const U = JSON.parse(readFileSync(path.join(import.meta.dirname, "out-users.json"), "utf8"));
const out: Record<string, unknown> = {};
const log = newLog();
const browser = await pw.chromium.launch();
const sessionA = await passwordSession(U.users.a.email, U.password);
const sessionB = await passwordSession(U.users.b.email, U.password);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settle = async (page: any) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(600);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ctx(opts: Record<string, unknown> = {}, session?: unknown): Promise<any> {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: UA,
    timezoneId: "Europe/Madrid",
    ...opts,
  });
  await wire(c, log);
  if (session) await signedInInit(c, session, "en");
  return c;
}

// ---------------- P3: deep links survive a refresh ----------------
{
  const res: Record<string, unknown> = {};
  for (const signed of [false, true]) {
    const c = await ctx({}, signed ? sessionB : undefined);
    const p = await c.newPage();
    for (const link of [
      `/leagues?code=${U.league.code.toLowerCase()}`,
      "/picks",
      "/results",
      "/picks?match=1",
      "/standings?join=ABC234",
      "/leaderboard?page=2&view=me",
    ]) {
      await p.goto(`${APP}${link}`);
      await settle(p);
      console.error("loaded", signed, link);
      const first = {
        url: p.url().replace(APP, ""),
        h1: await p
          .locator("h1")
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => null),
        dialog: await p.locator('[role="dialog"]').count(),
        code: await p
          .locator('input[aria-label="League code"]')
          .inputValue({ timeout: 500 })
          .catch(() => null),
      };
      await p.reload();
      await settle(p);
      const again = {
        url: p.url().replace(APP, ""),
        h1: await p
          .locator("h1")
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => null),
        dialog: await p.locator('[role="dialog"]').count(),
        code: await p
          .locator('input[aria-label="League code"]')
          .inputValue({ timeout: 500 })
          .catch(() => null),
      };
      res[`${signed ? "in" : "out"} ${link}`] = { first, afterRefresh: again };
      console.error("done", signed, link);
    }
    if (!signed) {
      // an invite opened signed out: does the code survive the detour through sign-in?
      await p.goto(`${APP}/leagues?code=${U.league.code}`);
      await settle(p);
      await p.locator("main a", { hasText: "Sign in" }).click();
      await settle(p);
      res["out invite → sign-in link"] = p.url().replace(APP, "");
    }
    await c.close();
  }
  // F-15: a full load of /picks?match=1 shows the saved pick (A has one)
  const c = await ctx({}, sessionA);
  const p = await c.newPage();
  await p.goto(`${APP}/picks?match=1`);
  await settle(p);
  res["F-15 sheet on full load"] = {
    pressed: await p.locator('[role="dialog"] button[aria-pressed="true"]').count(),
    button: await p.locator('[role="dialog"] button.h-12').innerText(),
  };
  await c.close();
  out["P3"] = res;
}

// ---------------- P4: time zones ----------------
{
  const res: Record<string, unknown> = {};
  const matches = (await (
    await fetch(`${API}/rest/v1/matches?select=match_no,starts_at&order=match_no`, {
      headers: { apikey: process.env.ANON_KEY! },
    })
  ).json()) as { match_no: number; starts_at: string }[];
  const fmt = (iso: string, tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const expectRiyadh = matches.map((m) => fmt(m.starts_at, "Asia/Riyadh"));
  for (const tz of ["Europe/Madrid", "Asia/Riyadh", "America/New_York"]) {
    const c = await ctx({ timezoneId: tz }, sessionA);
    const p = await c.newPage();
    await p.goto(`${APP}/results`);
    await settle(p);
    const body = await p.locator("main").innerText();
    const times = [
      ...body.matchAll(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}\b/g),
    ].map((m) => m[0]);
    await p.goto(`${APP}/picks`);
    await settle(p);
    const picksBody = await p.locator("main").innerText();
    const ptimes = [
      ...picksBody.matchAll(
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}\b/g,
      ),
    ].map((m) => m[0]);
    const tzLabel = /Riyadh|AST|GMT|UTC|\+03|local time|your time|KSA/i.test(body + picksBody);
    await p.screenshot({ path: path.join(SCREENS, `picks-en-390-tz-${tz.replace("/", "_")}.png`) });
    res[tz] = {
      resultsTimes: times,
      picksTimes: ptimes,
      allAreRiyadhTimes: [...times, ...ptimes].every((t) => expectRiyadh.includes(t)),
      deviceLocalWouldBe: matches.slice(0, 2).map((m) => fmt(m.starts_at, tz)),
      anyTimezoneLabelOnScreen: tzLabel,
    };
    await c.close();
  }
  res["expected Riyadh"] = expectRiyadh;
  out["P4"] = res;
}

// ---------------- L6: two tabs; sign out in one ----------------
{
  const res: Record<string, unknown> = {};
  const c = await ctx({}, sessionB);
  const t1 = await c.newPage();
  await t1.goto(`${APP}/picks?match=1`);
  await settle(t1);
  const t2 = await c.newPage();
  await t2.goto(`${APP}/profile`);
  await settle(t2);
  res["tab2 signed in"] = await t2.locator("header nav").innerText();
  // tab 1 has the pick sheet open with a change; tab 2 signs out
  await t1.bringToFront();
  await t1.locator('[role="dialog"] button[aria-label^="Player C"]').click();
  await sleep(300);
  await t2.bringToFront();
  await t2.getByRole("button", { name: "Sign out" }).click();
  await settle(t2);
  await sleep(1500);
  await t1.bringToFront();
  res["tab1 after sign-out elsewhere"] = {
    header: await t1.locator("header nav").innerText(),
    dialog: await t1.locator('[role="dialog"]').count(),
    storage: await t1.evaluate(() => Object.keys(localStorage)),
  };
  // if the sheet is still open, try to save from the signed-out tab
  if (await t1.locator('[role="dialog"]').count()) {
    const r = t1.waitForResponse(/rpc\/save_pick/, { timeout: 8000 }).catch(() => null);
    await t1.locator('[role="dialog"] button.h-12').click();
    const resp = await r;
    await sleep(1500);
    res["tab1 save after sign-out"] = {
      status: resp ? resp.status() : null,
      body: resp ? (await resp.text()).slice(0, 200) : null,
      alert: await t1.locator('[role="alert"]').allInnerTexts(),
    };
  }
  // tab 1 reloads: still signed out?
  await t1.reload();
  await settle(t1);
  res["tab1 after reload"] = await t1.locator("header nav").innerText();
  await t1.screenshot({ path: path.join(SCREENS, "picks-en-390-two-tabs-signed-out.png") });
  await c.close();

  // sign in as A in one tab while B is signed in in another tab of the same browser profile
  const c2 = await ctx({}, sessionB);
  const a = await c2.newPage();
  await a.goto(`${APP}/standings`);
  await settle(a);
  const b = await c2.newPage();
  await b.goto(`${APP}/sign-in`);
  await settle(b);
  await b.getByRole("tab", { name: "I have an account" }).click();
  await b.getByLabel("Email").fill(U.users.a.email);
  await b.getByLabel("Password", { exact: true }).fill(U.password);
  await b.locator('form button[type="submit"]').click();
  await settle(b);
  await sleep(1500);
  await a.bringToFront();
  await sleep(500);
  res["switch account in other tab"] = {
    tabA_avatar: await a
      .locator("header nav a[aria-label='Profile']")
      .innerText()
      .catch(() => null),
    tabA_rows_me: await a.locator("tr.bg-accent\\/10, li.bg-accent\\/10").allInnerTexts(),
  };
  await c2.close();
  out["L6"] = res;
}

// ---------------- P5: analytics in a full click-through (client-side navigation) ----------------
{
  const before = log.posthog.length;
  const c = await ctx({}, sessionB);
  const p = await c.newPage();
  await p.goto(`${APP}/`);
  await settle(p);
  for (const tab of ["Picks", "Results", "Standings"]) {
    await p.locator("nav.fixed a", { hasText: tab }).click();
    await settle(p);
  }
  await p.locator("header a[aria-label='How to play']").click();
  await settle(p);
  await p.locator("header a[aria-label='Profile']").click();
  await settle(p);
  // standings: league tab, invite (clipboard fallback: no navigator.share in desktop chromium), create + join
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await p.goto(`${APP}/standings?league=${U.league.id}`);
  await settle(p);
  await p.getByRole("button", { name: "Invite" }).click();
  await sleep(500);
  out["invite clipboard"] = await p
    .evaluate(() => navigator.clipboard.readText())
    .catch((e: unknown) => String(e));
  await p.getByRole("button", { name: "+ League" }).click();
  await p.getByLabel("League name").fill("P audit two");
  await p.getByRole("button", { name: "Create" }).click();
  await settle(p);
  // sign out, sign in with password
  await p.goto(`${APP}/profile`);
  await settle(p);
  await p.getByRole("button", { name: "Sign out" }).click();
  await settle(p);
  await p.goto(`${APP}/sign-in`);
  await settle(p);
  await p.getByRole("tab", { name: "I have an account" }).click();
  await p.getByLabel("Email").fill(U.users.b.email);
  await p.getByLabel("Password", { exact: true }).fill(U.password);
  await p.locator('form button[type="submit"]').click();
  await settle(p);
  // join the league A owns? B is in it already: join_league with the code → already member path
  await p.goto(`${APP}/standings?join=${U.league.code}`);
  await settle(p);
  await p.getByRole("button", { name: "Join", exact: true }).click();
  await settle(p);
  out["join own league again"] = await p.locator('[role="status"], [role="alert"]').allInnerTexts();
  await sleep(4000);
  await c.close();
  const evs = log.posthog.slice(before);
  out["P5 click-through"] = evs.map((e) => ({
    event: e.event,
    name: e.props["name"],
    $pathname: e.props["$pathname"],
    custom: Object.fromEntries(
      Object.entries(e.props).filter(
        ([k]) => !k.startsWith("$") && k !== "token" && k !== "distinct_id",
      ),
    ),
  }));
}

await browser.close();
const allPh = JSON.stringify(log.posthog);
out["P5 personal-data scan"] = {
  emails: (allPh.match(/p-[a-z0-9]+@example\.test/g) ?? []).length,
  leagueCodeInUrls: allPh.includes(U.league.code),
  joinParamInUrls: (allPh.match(/join=[A-Z0-9]{6}/g) ?? []).slice(0, 3),
  displayNames: allPh.includes(U.users.a.name) || allPh.includes(U.users.b.name),
};
out["console"] = log.console.filter((x) => !x.url.startsWith("about:"));
out["blocked"] = [...new Set(log.blocked)];
writeFileSync(path.join(import.meta.dirname, "out-flows.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 12000));

// Assertions (P4 BUG, L6 BUG): every on-screen time must name its time zone; a sign-out in another tab
// must not silently drop an open pick sheet.
const p4 = out["P4"] as Record<string, { anyTimezoneLabelOnScreen?: boolean }>;
const fails: string[] = [];
for (const tz of ["Europe/Madrid", "Asia/Riyadh", "America/New_York"])
  if (!p4[tz]?.anyTimezoneLabelOnScreen) fails.push(`P4 ${tz}: times shown with no time zone`);
const l6 = (out["L6"] as Record<string, { dialog?: number }>)["tab1 after sign-out elsewhere"];
if (l6 && l6.dialog === 0)
  fails.push("L6: the open pick sheet vanished with no message after a sign-out in another tab");
if (fails.length) {
  console.error("FAIL\n" + fails.join("\n"));
  process.exit(1);
}
