/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// P8: hosting headers (audit, 5 Oct 2026).
//   1. FAILS while dist/ has no _headers with CSP, HSTS, frame-ancestors/X-Frame-Options, Referrer-Policy,
//      X-Content-Type-Options and a no-cache rule for index.html; and if any *.map is emitted.
//   2. Stale deploy: after a deploy the old hashed chunks are gone, and the SPA rule "/* /index.html 200"
//      answers a missing /assets/*.js with index.html (200, text/html). An open tab then taps a tab.
//   3. A proposed CSP (PROPOSED_HEADERS below) served on every document: the click-through must log no
//      "Refused to …" violation.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/headers-check.ts <distDir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API, APP, UA, newLog, passwordSession, pw, signedInInit, sleep, wire } from "./lib";

const dist = path.resolve(process.argv[2] ?? "dist");
const out: Record<string, unknown> = {};
let failed = false;

// ---- 1. static checks ----
const headersFile = path.join(dist, "_headers");
const text = existsSync(headersFile) ? readFileSync(headersFile, "utf8") : "";
const need: [string, RegExp][] = [
  ["Content-Security-Policy", /content-security-policy/i],
  ["Strict-Transport-Security", /strict-transport-security/i],
  ["frame-ancestors or X-Frame-Options", /frame-ancestors|x-frame-options/i],
  ["Referrer-Policy (explicit)", /referrer-policy/i],
  ["X-Content-Type-Options", /x-content-type-options/i],
  ["index.html no-cache rule", /\/(index\.html)?\s*\n\s+cache-control:\s*no-cache/i],
  ["Permissions-Policy", /permissions-policy/i],
];
out["_headers present"] = existsSync(headersFile);
out["missing"] = need.filter(([, re]) => !re.test(text)).map(([n]) => n);
const maps = readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".map"));
out["source maps in dist"] = maps.length;
const html = readFileSync(path.join(dist, "index.html"), "utf8");
out["meta CSP in index.html"] = /http-equiv=["']content-security-policy/i.test(html);
if ((out["missing"] as string[]).length || maps.length) failed = true;

// ---- 2 + 3 in the browser ----
const U = JSON.parse(readFileSync(path.join(import.meta.dirname, "out-users.json"), "utf8"));
const session = await passwordSession(U.users.a.email, U.password);
const browser = await pw.chromium.launch();
{
  const log = newLog();
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await wire(c, log);
  await signedInInit(c, session, "en");
  const p = await c.newPage();
  await p.goto(`${APP}/`);
  await p.waitForLoadState("networkidle");
  // the deploy happens now: every chunk not loaded yet is answered with index.html, as Pages would
  const loaded = new Set(
    await p.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname),
    ),
  );

  await c.route(`${APP}/assets/*.js`, (r: any) =>
    loaded.has(new URL(r.request().url()).pathname)
      ? r.fallback()
      : r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await p.locator("nav.fixed a", { hasText: "Results" }).click();
  await sleep(2500);
  out["stale deploy: tap Results"] = {
    url: p.url().replace(APP, ""),
    body: (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160),
    console: log.console.map((x) => x.text.slice(0, 160)),
  };
  await p.screenshot({
    path: path.resolve(import.meta.dirname, "../screens/results-en-390-stale-deploy.png"),
  });
  await c.close();
}

const PROPOSED_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    `script-src 'self' https://challenges.cloudflare.com https://ph.audit.invalid`,
    `connect-src 'self' ${API} ${API.replace("http", "ws")} https://ph.audit.invalid`,
    `img-src 'self' data: blob: ${API} https://www.atptour.com`,
    "style-src 'self'",
    "font-src 'self' data:", // a small woff2 is inlined into the CSS as data: (Vite assetsInlineLimit)
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
{
  const log = newLog();
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await wire(c, log);

  await c.route(`${APP}/**`, async (r: any) => {
    if (r.request().resourceType() !== "document") return r.fallback();
    const res = await r.fetch();
    await r.fulfill({ response: res, headers: { ...res.headers(), ...PROPOSED_HEADERS } });
  });
  await signedInInit(c, session, "en");
  const p = await c.newPage();
  const violations: string[] = [];

  p.on(
    "console",
    (m: any) =>
      /Refused to|Content Security Policy/i.test(m.text()) &&
      violations.push(m.text().slice(0, 200)),
  );
  for (const u of ["/", "/picks?match=1", "/results", "/standings", "/profile", "/how-to-play"]) {
    await p.goto(`${APP}${u}`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await sleep(1200);
  }
  out["proposed CSP"] = PROPOSED_HEADERS["content-security-policy"];
  out["proposed CSP violations"] = [...new Set(violations)];
  await c.close();
}
await browser.close();
writeFileSync(path.join(import.meta.dirname, "out-headers.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (
  /something went wrong/i.test(String((out["stale deploy: tap Results"] as { body: string }).body))
) {
  console.error(
    "FAIL: after a deploy, an open tab that opens a new screen shows the error screen (stale chunk)",
  );
  failed = true;
}
if (failed) {
  console.error("FAIL: hosting headers missing (see 'missing')");
  process.exit(1);
}
