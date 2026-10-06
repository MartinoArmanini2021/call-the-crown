// The shipped public/_headers policy (fix for P8, 6 Oct 2026) in a real browser: serve the production
// build like Pages does, give every document the policy from public/_headers with only the Supabase
// pattern swapped for the local stack's origin, click through signed out and signed in, and fail on
// any "Refused to …" violation. Exercises: the app's own scripts/styles/fonts/images, Supabase REST
// and auth. Not exercised locally: Turnstile (no site key), PostHog (no key), ATP headshots (none).
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/csp-shipped.ts <distDir>   (served on :5182)
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  APP,
  API,
  UA,
  createUser,
  deleteTestUsers,
  passwordSession,
  pw,
  signedInInit,
  sleep,
} from "./lib";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const headers = readFileSync(path.join(ROOT, "public", "_headers"), "utf8");
const shipped = headers.match(/Content-Security-Policy:\s*(.+)/)![1]!.trim();
const local = shipped
  .replaceAll("https://*.supabase.co", API)
  .replaceAll("wss://*.supabase.co", API.replace("http", "ws"));

const PASS = "audit-csp-check-5512";
const email = `p-csp${Date.now() % 100000}@example.test`;
await createUser(email, PASS, "Csp Audit");
const session = await passwordSession(email, PASS);

const browser = await pw.chromium.launch();
const violations: string[] = [];
let documents = 0;
try {
  for (const signedIn of [false, true]) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await c.route("**/*", async (r: any) => {
      const u = new URL(r.request().url());
      if (u.origin !== APP && u.origin !== API) return r.abort();
      if (u.origin !== APP || r.request().resourceType() !== "document") return r.fallback();
      const res = await r.fetch();
      documents++;
      await r.fulfill({
        response: res,
        headers: { ...res.headers(), "content-security-policy": local },
      });
    });
    if (signedIn) await signedInInit(c, session, "en");
    const p = await c.newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.on("console", (m: any) => {
      if (/Refused to|Content Security Policy/i.test(m.text()))
        violations.push(m.text().slice(0, 240));
    });
    const routes = signedIn
      ? [
          "/",
          "/picks",
          "/picks?match=1",
          "/results",
          "/standings",
          "/leaderboard",
          "/profile",
          "/how-to-play",
        ]
      : ["/", "/sign-in", "/how-to-play", "/results", "/standings"];
    for (const u of routes) {
      await p.goto(`${APP}${u}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
    }
    await c.close();
  }
} finally {
  await browser.close();
  console.log("deleted:", await deleteTestUsers());
}
console.log(
  JSON.stringify({ documents, policy: local, violations: [...new Set(violations)] }, null, 2),
);
if (!documents || violations.length) process.exit(1);
