// P1 special states at 390 px (EN + AR), plus re-checks of the 3 Oct leads F-13, F-15, F-18, F-19
// (audit, 5 Oct 2026). Started/settled states come from response fixtures (route interception), never
// from changing the shared database.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/states.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  API,
  APP,
  SCREENS,
  STORAGE_KEY,
  UA,
  forceArabicFlag,
  newLog,
  passwordSession,
  pw,
  signedInInit,
  sleep,
  wire,
} from "./lib";

const U = JSON.parse(readFileSync(path.join(import.meta.dirname, "out-users.json"), "utf8"));
const log = newLog();
const notes: Record<string, unknown> = {};
const browser = await pw.chromium.launch();
const sessionA = await passwordSession(U.users.a.email, U.password);

// ---------- fixtures ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function settledFixtures(context: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/matches*`, async (route: any) => {
    const res = await route.fetch();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await res.json();
    for (const m of rows) {
      if (m.match_no === 1)
        Object.assign(m, {
          status: "completed",
          winner_id: "c",
          set_scores: [
            { p1_games: 6, p2_games: 4 },
            { p1_games: 7, p2_games: 5 },
          ],
          started_at: new Date(Date.parse(m.starts_at) + 120_000).toISOString(),
        });
      if (m.match_no === 2)
        Object.assign(m, {
          status: "retired",
          winner_id: "d",
          set_scores: [
            { p1_games: 6, p2_games: 3 },
            { p1_games: 2, p2_games: 1 },
          ],
          started_at: new Date(Date.parse(m.starts_at) + 60_000).toISOString(),
        });
      if (m.match_no === 3) m.p2_id = "c";
      if (m.match_no === 4) m.p2_id = "d";
    }
    await route.fulfill({ response: res, json: rows });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/picks*`, async (route: any) => {
    const res = await route.fetch();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await res.json();
    for (const p of rows)
      if (p.match_no === 1)
        Object.assign(p, {
          pts_winner: 8,
          pts_sets: 4,
          pts_exact: 2,
          exact_sets: 1,
          pts_total: 14,
          exact_flags: [true, false],
        });
    rows.push({
      match_no: 2,
      winner_id: "d",
      sets: 2,
      set_scores: [
        { p1_games: 6, p2_games: 3 },
        { p1_games: 6, p2_games: 2 },
      ],
      updated_at: "2026-10-20T10:00:00Z",
      pts_winner: 8,
      pts_sets: 0,
      pts_exact: 0,
      exact_sets: 0,
      pts_total: 8,
      exact_flags: null,
    });
    await route.fulfill({ response: res, json: rows });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/rpc/get_match_crowd`, (route: any) =>
    route.fulfill({
      json: [
        {
          picks: 1234,
          p1_picks: 800,
          p2_picks: 434,
          top_score: [
            { p1_games: 6, p2_games: 4 },
            { p1_games: 6, p2_games: 3 },
          ],
          top_count: 99,
        },
      ],
    }),
  );
  const names = [
    "Ana",
    "Ben",
    "Cy",
    "Dee",
    "Eli",
    "Fay",
    "Gus",
    "Hal",
    "Ivy",
    "Jo",
    "عبد الرحمن الشمري",
    "Maximilian-Alexander Featherstonehaugh",
  ];
  const row = (pos: number, me: boolean) => ({
    pos,
    global_rank: pos,
    user_id: me ? U.users.a.id : `00000000-0000-0000-0000-${String(pos).padStart(12, "0")}`,
    display_name: me ? U.users.a.name : `${names[pos % names.length]} ${pos}`,
    points: 200 - pos,
    exact_sets: 10 - (pos % 10),
    is_me: me,
    total: 137,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/rpc/get_leaderboard`, async (route: any) => {
    const a = JSON.parse(route.request().postData() ?? "{}");
    if (a.p_league) return route.fallback();
    const out = [];
    for (let i = a.p_offset + 1; i <= Math.min(137, a.p_offset + a.p_limit); i++)
      out.push(row(i, i === 64));
    return route.fulfill({ json: out });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/rpc/get_rank_window`, async (route: any) => {
    const a = JSON.parse(route.request().postData() ?? "{}");
    if (a.p_league) return route.fallback();
    const out = [];
    for (let i = 59; i <= 69; i++) out.push(row(i, i === 64));
    return route.fulfill({ json: out.map(({ total: _t, ...r }) => r) });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ctx(lang: "en" | "ar", signedIn: boolean, extra?: (c: any) => Promise<void>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Europe/Madrid",
    userAgent: UA,
  });
  await wire(context, log);
  if (lang === "ar") await forceArabicFlag(context);
  if (signedIn) await signedInInit(context, sessionA, lang);
  else await context.addInitScript((l: string) => localStorage.setItem("locale", l), lang);
  if (extra) await extra(context);
  return context;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shot = (page: any, name: string) =>
  page.screenshot({ path: path.join(SCREENS, name), fullPage: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settle = async (page: any) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(500);
};

for (const lang of ["en", "ar"] as const) {
  // ---- loading: the bracket never answers ----
  {
    const c = await ctx(lang, true, async (c) => {
      await c.route(`${API}/rest/v1/matches*`, () => new Promise(() => {}));
    });
    const p = await c.newPage();
    for (const r of ["picks", "results"]) {
      await p.goto(`${APP}/${r}`);
      await sleep(1500);
      await shot(p, `${r}-${lang}-390-loading.png`);
    }
    // boot: event_config never answers → blank page with aria-busy
    await c.route(`${API}/rest/v1/event_config*`, () => new Promise(() => {}));
    await p.goto(`${APP}/standings`);
    await sleep(1500);
    await shot(p, `boot-${lang}-390-loading.png`);
    await c.close();
  }
  // ---- error: the bracket fails; then the event config fails (boot) ----
  {
    const c = await ctx(lang, true, async (c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await c.route(`${API}/rest/v1/matches*`, (r: any) =>
        r.fulfill({ status: 500, json: { message: "boom" } }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await c.route(`${API}/rest/v1/rpc/get_leaderboard`, (r: any) =>
        r.fulfill({ status: 500, json: { message: "boom" } }),
      );
    });
    const p = await c.newPage();
    for (const r of ["picks", "results", "standings"]) {
      await p.goto(`${APP}/${r}`);
      await sleep(4000); // one retry
      await shot(p, `${r}-${lang}-390-error.png`);
      notes[`error-${r}-${lang}`] = (await p.locator("main").innerText()).slice(0, 200);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await c.route(`${API}/rest/v1/event_config*`, (r: any) =>
      r.fulfill({ status: 500, json: { message: "boom" } }),
    );
    await p.goto(`${APP}/picks`);
    await sleep(4000);
    await shot(p, `boot-${lang}-390-error.png`);
    notes[`error-boot-${lang}`] = (await p.locator("body").innerText()).slice(0, 200);
    await c.close();
  }
  // ---- settled (fixtures): results, the result sheet of a finished and a retired match, standings ----
  {
    const c = await ctx(lang, true, settledFixtures);
    const p = await c.newPage();
    await p.goto(`${APP}/results`);
    await settle(p);
    await shot(p, `results-${lang}-390-settled.png`);
    notes[`results-stats-${lang}`] = (await p.locator("main .grid").first().innerText()).replace(
      /\s+/g,
      " ",
    );
    await p.locator('[data-match="1"]').click();
    await p.waitForSelector('[role="dialog"]');
    await sleep(800);
    await shot(p, `results-sheet-${lang}-390-settled-completed.png`);
    notes[`result-sheet-1-${lang}`] = (await p.locator('[role="dialog"]').innerText()).replace(
      /\s+/g,
      " ",
    );
    await p.keyboard.press("Escape");
    await p.locator('[data-match="2"]').click();
    await p.waitForSelector('[role="dialog"]');
    await sleep(800);
    await shot(p, `results-sheet-${lang}-390-settled-retired.png`);
    notes[`result-sheet-2-${lang}`] = (await p.locator('[role="dialog"]').innerText()).replace(
      /\s+/g,
      " ",
    );
    await p.keyboard.press("Escape");
    // F-19: tap the selected stage tab twice
    const tabs = p.locator('[role="tablist"] [role="tab"]');
    await tabs.nth(1).click();
    await sleep(900);
    const a1 = await p.evaluate(() => ({
      sel: [...document.querySelectorAll('[role="tab"]')].findIndex(
        (t) => t.getAttribute("aria-selected") === "true",
      ),
      x: document.querySelector("section[aria-label]")?.parentElement?.scrollLeft,
    }));
    await tabs.nth(1).click();
    await sleep(900);
    const a2 = await p.evaluate(() => ({
      sel: [...document.querySelectorAll('[role="tab"]')].findIndex(
        (t) => t.getAttribute("aria-selected") === "true",
      ),
      x: document.querySelector("section[aria-label]")?.parentElement?.scrollLeft,
    }));
    notes[`F-19-${lang}`] = { afterFirstTap: a1, afterSecondTap: a2 };
    await p.goto(`${APP}/standings`);
    await settle(p);
    await shot(p, `standings-${lang}-390-settled.png`);
    await p.goto(`${APP}/standings?page=2`);
    await settle(p);
    await shot(p, `standings-${lang}-390-settled-page2.png`);
    await c.close();
  }
  // ---- empty: nothing open (all matches settled/locked) signed out; and a fresh fan with no leagues ----
  {
    const c = await ctx(lang, false, async (c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await c.route(`${API}/rest/v1/matches*`, async (route: any) => {
        const res = await route.fetch();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: any[] = await res.json();
        for (const m of rows) m.starts_at = "2026-10-01T10:00:00Z";
        await route.fulfill({ response: res, json: rows });
      });
    });
    const p = await c.newPage();
    await p.goto(`${APP}/picks`);
    await settle(p);
    await shot(p, `picks-${lang}-390-empty.png`);
    notes[`empty-picks-${lang}`] = (await p.locator("main").innerText())
      .replace(/\s+/g, " ")
      .slice(0, 200);
    await c.close();
  }
}

// ---- F-13: the owner's member list asks for every page (fixture: 150 members) ----
{
  const asked: unknown[] = [];
  const c = await ctx("en", true, async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await c.route(`${API}/rest/v1/rpc/my_leagues`, async (route: any) => {
      const res = await route.fetch();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await res.json();
      for (const l of rows) l.member_count = 150;
      await route.fulfill({ response: res, json: rows });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await c.route(`${API}/rest/v1/rpc/get_leaderboard`, async (route: any) => {
      const a = JSON.parse(route.request().postData() ?? "{}");
      asked.push(a);
      const out = [];
      for (let i = a.p_offset + 1; i <= Math.min(150, a.p_offset + Math.min(a.p_limit, 100)); i++)
        out.push({
          pos: i,
          global_rank: null,
          user_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
          display_name: `Member ${i}`,
          points: 0,
          exact_sets: 0,
          is_me: i === 1,
          total: 150,
        });
      await route.fulfill({ json: out });
    });
  });
  const p = await c.newPage();
  await p.goto(`${APP}/standings?league=${U.league.id}`);
  await settle(p);
  await p.getByRole("button", { name: "Manage" }).click();
  await settle(p);
  const listed = await p.locator("section.card ul li").count();
  notes["F-13"] = {
    requests: asked.filter((a) => (a as { p_limit: number }).p_limit === 100),
    membersListed: listed,
  };
  await c.close();
}

// ---- offline mid-save and session expired mid-pick (EN + AR) ----
for (const lang of ["en", "ar"] as const) {
  {
    const c = await ctx(lang, true);
    const p = await c.newPage();
    await p.goto(`${APP}/picks?match=1`);
    await p.waitForSelector('[role="dialog"]');
    await settle(p);
    // change set 2 to 6-2 then cut the network and save
    await p
      .locator(
        '[role="dialog"] button[aria-label^="Set 2"][aria-pressed="false"], [role="dialog"] button[aria-label^="المجموعة 2"][aria-pressed="false"]',
      )
      .first()
      .click();
    await c.setOffline(true);
    const t0 = Date.now();
    await p.locator('[role="dialog"] button.h-12').click();
    const timeline: string[] = [];
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const open = await p.locator('[role="dialog"]').count();
      const txt = open
        ? await p
            .locator('[role="dialog"] button.h-12')
            .innerText()
            .catch(() => "?")
        : "<closed>";
      const alert = open
        ? (await p.locator('[role="dialog"] [role="alert"]').allInnerTexts()).join("|")
        : "";
      timeline.push(
        `${Math.round((Date.now() - t0) / 1000)}s ${txt}${alert ? ` alert=${alert}` : ""}`,
      );
      if (i === 2) await shot(p, `picks-sheet-${lang}-390-offline.png`);
      if (alert) break;
    }
    await c.setOffline(false);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const open = await p.locator('[role="dialog"]').count();
      timeline.push(
        `online+${i + 1}s ${
          open
            ? await p
                .locator('[role="dialog"] button.h-12')
                .innerText()
                .catch(() => "?")
            : "<closed>"
        } status=${(await p.locator('[role="status"]').allInnerTexts()).join("|").slice(0, 60)}`,
      );
      if (!open) break;
    }
    notes[`offline-${lang}`] = timeline;
    await c.close();
  }
  {
    // session expired: an access token past expiry and a refresh token the server no longer knows
    const c = await ctx(lang, false);
    await c.addInitScript(
      ([key, value, l]: [string, string, string]) => {
        if (!sessionStorage.getItem("__exp")) {
          localStorage.setItem(key, value);
          localStorage.setItem("locale", l);
          sessionStorage.setItem("__exp", "1");
        }
      },
      [STORAGE_KEY, JSON.stringify({ ...sessionA, refresh_token: "revoked-refresh-token" }), lang],
    );
    const p = await c.newPage();
    await p.goto(`${APP}/picks?match=1`);
    await p.waitForSelector('[role="dialog"]');
    await settle(p);
    // now expire it in place (as if the phone slept for hours): the next call must refresh, and that fails
    await p.evaluate((key: string) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      s.expires_at = Math.floor(Date.now() / 1000) - 3600;
      localStorage.setItem(key, JSON.stringify(s));
    }, STORAGE_KEY);
    const before = await p.locator('[role="dialog"]').count();
    await p
      .locator(
        '[role="dialog"] button[aria-label^="Set 2"][aria-pressed="false"], [role="dialog"] button[aria-label^="المجموعة 2"][aria-pressed="false"]',
      )
      .first()
      .click();
    const saveReq = p.waitForRequest(/rpc\/save_pick/, { timeout: 8000 }).catch(() => null);
    await p.locator('[role="dialog"] button.h-12').click();
    const req = await saveReq;
    await sleep(2500);
    await shot(p, `picks-${lang}-390-session-expired.png`);
    notes[`expired-${lang}`] = {
      dialogBefore: before,
      saveRequestSent: !!req,
      saveAuth: req ? (req.headers()["authorization"] ?? "").slice(0, 20) : null,
      dialogAfter: await p.locator('[role="dialog"]').count(),
      alerts: await p.locator('[role="alert"], [role="status"]').allInnerTexts(),
      url: p.url(),
      header: await p.locator("header nav").innerText(),
    };
    await c.close();
  }
}

await browser.close();
writeFileSync(
  path.join(import.meta.dirname, "out-states.json"),
  JSON.stringify({ notes, console: log.console, blocked: log.blocked }, null, 2),
);
console.log(JSON.stringify(notes, null, 2));
console.log(
  "console:",
  JSON.stringify(
    log.console.filter((x) => !x.url.startsWith("about:")),
    null,
    1,
  ).slice(0, 3000),
);

// Assertions: offline save must say so within 10 s; an expired session must not drop the pick silently.
const fails: string[] = [];
for (const lang of ["en", "ar"]) {
  const tl = notes[`offline-${lang}`] as string[];
  if (tl.slice(0, 10).every((l) => !/alert=/.test(l)))
    fails.push(`offline ${lang}: 10 s of "Saving" with no message`);
  const ex = notes[`expired-${lang}`] as { dialogAfter: number; alerts: string[] };
  if (ex.dialogAfter === 0 && ex.alerts.length === 0)
    fails.push(`expired ${lang}: sheet closed, no message, edit lost`);
}
if (fails.length) {
  console.error("FAIL\n" + fails.join("\n"));
  process.exit(1);
}
