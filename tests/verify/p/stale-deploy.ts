// After a deploy, an open tab whose next screen's chunk is gone (fix for P8 stale deploy, 6 Oct 2026).
//   A. the deploy has finished: the tab must recover by itself and show the screen the fan tapped;
//   B. the chunk stays missing: at most one automatic reload (no loop), then the error screen, whose
//      "Try again" reloads the page instead of re-rendering the same failure.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/stale-deploy.ts   (build served on :5182)
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

const PASS = "audit-stale-check-7710";
const email = `p-stale${Date.now() % 100000}@example.test`;
await createUser(email, PASS, "Stale Audit");
const session = await passwordSession(email, PASS);
const browser = await pw.chromium.launch();
const out: Record<string, unknown> = {};
let failed = false;

async function scenario(deployFinishes: boolean) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await signedInInit(c, session, "en");
  const p = await c.newPage();
  let documents = 0;
  p.on(
    "request",
    (r: { resourceType(): string }) => r.resourceType() === "document" && documents++,
  );
  await p.goto(`${APP}/`);
  await p.waitForLoadState("networkidle");
  const html = await (await fetch(`${APP}/index.html`)).text();
  const loaded = new Set<string>(
    await p.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname),
    ),
  );
  // the deploy: every chunk this tab has not loaded yet is answered with index.html, as Pages does
  let stale = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await c.route(`${APP}/assets/*.js`, (r: any) =>
    stale && !loaded.has(new URL(r.request().url()).pathname)
      ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
      : r.fallback(),
  );
  // once the tab reloads, the new build is what it gets (A); in B the chunk stays missing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.on("request", (r: any) => {
    if (deployFinishes && r.resourceType() === "document" && documents > 1) stale = false;
  });
  const before = documents;
  await p.locator("nav.fixed a", { hasText: "Results" }).click();
  await sleep(4000);
  const body = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  const reloads = documents - before;
  const res: Record<string, unknown> = {
    url: p.url().replace(APP, ""),
    reloads,
    body: body.slice(0, 120),
  };
  if (deployFinishes) {
    if (/something went wrong/i.test(body) || !p.url().endsWith("/results")) failed = true;
  } else {
    if (reloads > 1) failed = true; // a loop
    if (/something went wrong/i.test(body)) {
      const n = documents;
      await p.getByRole("button", { name: /try again/i }).click();
      await sleep(2500);
      res["try again reloads"] = documents > n;
      if (documents <= n) failed = true;
    }
  }
  await c.close();
  return res;
}

try {
  out["A deploy finished"] = await scenario(true);
  out["B chunk stays missing"] = await scenario(false);
} finally {
  await browser.close();
  console.log("deleted:", await deleteTestUsers());
}
console.log(JSON.stringify(out, null, 2));
if (failed) {
  console.error("FAIL: an open tab does not recover from a deploy");
  process.exit(1);
}
