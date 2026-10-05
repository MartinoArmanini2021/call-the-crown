// P1 main matrix + P2 console + P5 analytics + size-leak capture (audit, 5 Oct 2026).
// Every route, EN and AR, at 360/390/768/1280, signed out and signed in (user A from setup-users.ts),
// against the production build served Pages-style on :5182 (serve-pages.ts). Arabic is forced on with
// a response rewrite (the local seed has flags.arabic = false). Screenshots:
// tests/verify/screens/<route>-<lang>-<width>-<state>.png; results in out-screens.json.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/screens.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  APP,
  SCREENS,
  UA,
  forceArabicFlag,
  layoutIssues,
  newLog,
  passwordSession,
  pw,
  signedInInit,
  sleep,
  wire,
} from "./lib";

const U = JSON.parse(readFileSync(path.join(import.meta.dirname, "out-users.json"), "utf8"));
const log = newLog();
const results: { shot: string; issues: string[]; clipped: string[]; lang: string; dir: string }[] =
  [];

const OUT_ROUTES = [
  ["landing", "/"],
  ["how-to-play", "/how-to-play"],
  ["sign-in", "/sign-in"],
  ["picks", "/picks"],
  ["results", "/results"],
  ["standings", "/standings"],
  ["profile", "/profile"],
  ["leagues-invite", `/leagues?code=${U.league.code}`],
  ["not-found", "/no-such-page"],
] as const;
const IN_ROUTES = [
  ["landing", "/"],
  ["picks", "/picks"],
  ["picks-sheet", "/picks?match=1"],
  ["results", "/results"],
  ["standings", "/standings"],
  ["standings-league", `/standings?league=${U.league.id}`],
  ["profile", "/profile"],
  ["how-to-play", "/how-to-play"],
] as const;

const browser = await pw.chromium.launch();
const session = await passwordSession(U.users.a.email, U.password);

for (const lang of ["en", "ar"] as const) {
  for (const width of [360, 390, 768, 1280]) {
    for (const state of ["out", "in"] as const) {
      const context = await browser.newContext({
        viewport: { width, height: width >= 768 ? 1000 : 800 },
        timezoneId: "Europe/Madrid",
        userAgent: UA,
        locale: lang === "ar" ? "ar-SA" : "en-GB",
      });
      await wire(context, log, { recordRest: width === 390 });
      if (lang === "ar") await forceArabicFlag(context);
      if (state === "in") await signedInInit(context, session, lang);
      else await context.addInitScript((l: string) => localStorage.setItem("locale", l), lang);
      const page = await context.newPage();
      for (const [name, url] of state === "in" ? IN_ROUTES : OUT_ROUTES) {
        await page.goto(`${APP}${url}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page
          .waitForSelector('[aria-busy="true"]', { state: "detached", timeout: 8000 })
          .catch(() => {});
        await sleep(400);
        const shot = `${name}-${lang}-${width}-${state === "in" ? "signedin" : "signedout"}.png`;
        await page.screenshot({ path: path.join(SCREENS, shot), fullPage: true });
        const li = await layoutIssues(page);
        const dir = await page.evaluate(
          () => `${document.documentElement.lang}/${document.documentElement.dir}`,
        );
        results.push({ shot, ...li, lang, dir });
      }
      await sleep(1500);
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(
  path.join(import.meta.dirname, "out-screens.json"),
  JSON.stringify(
    {
      results,
      console: log.console,
      blocked: log.blocked,
      posthog: log.posthog.map((e) => ({
        event: e.event,
        name: e.props["name"],
        path: e.props["$pathname"],
        url: e.props["$current_url"],
      })),
      rest: log.rest,
    },
    null,
    2,
  ),
);
const bad = results.filter((r) => r.issues.length);
console.log(`${results.length} screenshots; with layout issues: ${bad.length}`);
for (const r of bad) console.log(r.shot, r.issues.slice(0, 3));
console.log(
  "dir mismatches:",
  results.filter((r) => (r.lang === "ar") !== r.dir.includes("rtl")).map((r) => r.shot),
);
console.log("console:", log.console.length, "blocked:", [...new Set(log.blocked)].slice(0, 5));
console.log("events:", [...new Set(log.posthog.map((e) => e.event))]);
