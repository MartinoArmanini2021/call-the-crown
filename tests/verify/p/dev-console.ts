// P2: console errors and warnings in a click-through on the DEV server (React's development warnings
// only show there), EN and AR, signed out and signed in, including the sheets (audit, 5 Oct 2026).
//   bunx vite --port 5182 --strictPort   then   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/dev-console.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  APP,
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
const session = await passwordSession(U.users.a.email, U.password);
const browser = await pw.chromium.launch();
for (const lang of ["en", "ar"] as const) {
  for (const signed of [false, true]) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    await wire(c, log);
    if (lang === "ar") await forceArabicFlag(c);
    if (signed) await signedInInit(c, session, lang);
    else await c.addInitScript((l: string) => localStorage.setItem("locale", l), lang);
    const p = await c.newPage();
    await p.goto(`${APP}/`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    for (const tab of [0, 1, 2]) {
      await p.locator("nav.fixed a").nth(tab).click();
      await p.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
    }
    await p.locator("header nav a").first().click(); // how to play
    await sleep(1000);
    if (signed) {
      await p.goto(`${APP}/picks?match=1`);
      await sleep(2000);
      await p.keyboard.press("Escape");
      await sleep(500);
      await p.goto(`${APP}/standings?league=${U.league.id}`);
      await sleep(1500);
      await p.locator("section.card button.underline").first().click(); // Manage
      await sleep(1000);
      await p.goto(`${APP}/standings?join=${U.league.code}`);
      await sleep(1500);
      await p.keyboard.press("Escape");
      await p.goto(`${APP}/profile`);
      await sleep(1500);
    } else {
      await p.goto(`${APP}/sign-in`);
      await sleep(1500);
      await p.goto(`${APP}/no-such-page`);
      await sleep(1000);
    }
    await c.close();
  }
}
await browser.close();
const items = log.console.filter((x) => !x.url.startsWith("about:"));
writeFileSync(
  path.join(import.meta.dirname, "out-dev-console.json"),
  JSON.stringify(items, null, 2),
);
const agg: Record<string, string[]> = {};
for (const x of items)
  (agg[`${x.type}: ${x.text.slice(0, 220)}`] ||= []).push(x.url.replace(APP, ""));
for (const [k, v] of Object.entries(agg))
  console.log(`${k}\n   x${v.length} at ${[...new Set(v)].slice(0, 4).join(", ")}`);
console.log("total", items.length);
