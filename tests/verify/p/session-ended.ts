// L6 / P1 (fix 6 Oct 2026): when the session ends while the pick sheet is open, the fan is told the
// pick was not saved and offered the way back, instead of the sheet vanishing with no word.
//   1. the session expires mid-pick (expired access token, refresh token the server no longer knows);
//   2. the fan signs out in another tab.
// EN and AR (Arabic switched on by rewriting event_config.flags in the response).
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/session-ended.ts   (app on :5182)
import path from "node:path";
import {
  APP,
  STORAGE_KEY,
  UA,
  createUser,
  deleteTestUsers,
  passwordSession,
  pw,
  signedInInit,
  sleep,
} from "./lib";

const PASS = "audit-session-ended-4471";
const email = `p-ended${Date.now() % 100000}@example.test`;
await createUser(email, PASS, "Ended Audit");
const browser = await pw.chromium.launch();
const out: Record<string, unknown> = {};
let failed = false;
const ENDED = { en: /session ended/i, ar: /انتهت جلستك/ };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function arabicOn(c: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await c.route("**/rest/v1/event_config*", async (r: any) => {
    const res = await r.fetch();
    const body = await res.json();
    const rows = Array.isArray(body) ? body : [body];
    for (const row of rows) row.flags = { ...(row.flags ?? {}), arabic: true };
    await r.fulfill({ response: res, json: Array.isArray(body) ? rows : rows[0] });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verdict(p: any, lang: "en" | "ar", name: string) {
  await sleep(2500);
  const alerts: string[] = await p.locator('[role="alert"]').allInnerTexts();
  const link = await p.locator('[role="alert"] a[href^="/sign-in"]').count();
  const res = { dialog: await p.locator('[role="dialog"]').count(), alerts, signInLink: link > 0 };
  out[name] = res;
  await p.screenshot({ path: path.resolve(import.meta.dirname, `../screens/${name}.png`) });
  if (!alerts.some((a) => ENDED[lang].test(a)) || !link) failed = true;
}

try {
  for (const lang of ["en", "ar"] as const) {
    // 1. expired mid-pick
    {
      const session = await passwordSession(email, PASS);
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
      await arabicOn(c);
      await c.addInitScript(
        ([key, value, l]: [string, string, string]) => {
          if (!sessionStorage.getItem("__exp")) {
            localStorage.setItem(key, value);
            localStorage.setItem("locale", l);
            sessionStorage.setItem("__exp", "1");
          }
        },
        [STORAGE_KEY, JSON.stringify({ ...session, refresh_token: "revoked-refresh-token" }), lang],
      );
      const p = await c.newPage();
      await p.goto(`${APP}/picks?match=1`);
      await p.waitForSelector('[role="dialog"]');
      await sleep(800);
      await p.evaluate((key: string) => {
        const s = JSON.parse(localStorage.getItem(key)!);
        s.expires_at = Math.floor(Date.now() / 1000) - 3600;
        localStorage.setItem(key, JSON.stringify(s));
      }, STORAGE_KEY);
      await p.locator('[role="dialog"] button[aria-pressed="false"]').first().click();
      await p
        .locator('[role="dialog"] button.h-12')
        .click()
        .catch(() => {});
      await verdict(p, lang, `session-ended-expired-${lang}`);
      await c.close();
    }
    // 2. signed out in another tab
    {
      const session = await passwordSession(email, PASS);
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
      await arabicOn(c);
      await signedInInit(c, session, lang);
      const p = await c.newPage();
      await p.goto(`${APP}/picks?match=1`);
      await p.waitForSelector('[role="dialog"]');
      await sleep(800);
      const other = await c.newPage();
      await other.goto(`${APP}/profile`);
      await other.waitForLoadState("networkidle").catch(() => {});
      await other.getByRole("button", { name: /^(Sign out|تسجيل الخروج)$/ }).click();
      await p.bringToFront();
      await verdict(p, lang, `session-ended-other-tab-${lang}`);
      await c.close();
    }
  }
  // no false alarm: a signed-in fan closing the sheet, and a signed-out visitor on a match link
  {
    const session = await passwordSession(email, PASS);
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    await signedInInit(c, session, "en");
    const p = await c.newPage();
    await p.goto(`${APP}/picks?match=1`);
    await p.waitForSelector('[role="dialog"]');
    await p.keyboard.press("Escape");
    await sleep(1500);
    const closed = {
      dialog: await p.locator('[role="dialog"]').count(),
      alerts: await p.locator('[role="alert"]').allInnerTexts(),
    };
    out["no alarm: sheet closed while signed in"] = closed;
    if (closed.dialog !== 0 || closed.alerts.length) failed = true;
    await c.close();
  }
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    const p = await c.newPage();
    await p.goto(`${APP}/picks?match=1`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    const anon = await p.locator('[role="alert"]').allInnerTexts();
    out["no alarm: signed-out visitor on /picks?match=1"] = anon;
    if (anon.length) failed = true;
    await c.close();
  }
} finally {
  await browser.close();
  console.log("deleted:", await deleteTestUsers());
}
console.log(JSON.stringify(out, null, 2));
if (failed) {
  console.error("FAIL: the pick sheet disappears with no word when the session ends");
  process.exit(1);
}
