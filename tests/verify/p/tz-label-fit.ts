// The zone label added to match times (fix for P4, 6 Oct 2026) must fit: no clipped or overflowing
// time on the match cards, the draw and the pick sheet toast, at 360 and 390 px, in EN and AR.
// Arabic is switched on by rewriting event_config.flags in the response (the shipped config has it off).
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/tz-label-fit.ts   (app on :5182)
import path from "node:path";
import {
  APP,
  UA,
  createUser,
  deleteTestUsers,
  passwordSession,
  pw,
  signedInInit,
  sleep,
} from "./lib";

const PASS = "audit-tz-check-6620";
const email = `p-tz${Date.now() % 100000}@example.test`;
await createUser(email, PASS, "Tz Audit");
const session = await passwordSession(email, PASS);
const browser = await pw.chromium.launch();
const problems: string[] = [];
const seen: Record<string, string[]> = {};
try {
  for (const locale of ["en", "ar"] as const)
    for (const width of [360, 390]) {
      const c = await browser.newContext({
        viewport: { width, height: 844 },
        userAgent: UA,
        timezoneId: "Europe/Madrid",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await c.route("**/rest/v1/event_config*", async (r: any) => {
        const res = await r.fetch();
        const body = await res.json();
        const rows = Array.isArray(body) ? body : [body];
        for (const row of rows) row.flags = { ...(row.flags ?? {}), arabic: true };
        await r.fulfill({ response: res, json: Array.isArray(body) ? rows : rows[0] });
      });
      await signedInInit(c, session, locale);
      const p = await c.newPage();
      for (const u of ["/picks", "/results"]) {
        await p.goto(`${APP}${u}`);
        await p.waitForLoadState("networkidle").catch(() => {});
        await sleep(1200);
        const r = await p.evaluate(() => {
          const out: { text: string; clipped: boolean; outside: boolean }[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const t = walker.currentNode.textContent ?? "";
            if (!/GMT|غرينتش|UTC/.test(t)) continue;
            const el = walker.currentNode.parentElement!;
            const box = el.getBoundingClientRect();
            // only times on screen: the draw's later stages sit in a sideways pager by design
            if (box.right <= 0 || box.left >= innerWidth) continue;
            const clipped =
              el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
            out.push({
              text: t.trim(),
              clipped,
              outside: box.right > innerWidth + 1 || box.left < -1,
            });
          }
          return { items: out, pageScroll: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        const key = `${u} ${locale} ${width}`;
        seen[key] = r.items.map((i: { text: string }) => i.text);
        if (!r.items.length) problems.push(`${key}: no zoned time on screen`);
        if (r.pageScroll) problems.push(`${key}: page scrolls sideways`);
        for (const i of r.items)
          if (i.clipped || i.outside) problems.push(`${key}: "${i.text}" clipped/outside`);
        await p.screenshot({
          path: path.resolve(
            import.meta.dirname,
            `../screens/tz-${u.slice(1)}-${locale}-${width}.png`,
          ),
        });
      }
      await c.close();
    }
} finally {
  await browser.close();
  console.log("deleted:", await deleteTestUsers());
}
console.log(JSON.stringify({ seen, problems }, null, 2));
if (problems.length) process.exit(1);
