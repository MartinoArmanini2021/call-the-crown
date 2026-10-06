/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright handles */
// Server-side captcha (decision 1, 6 Oct 2026): every Turnstile token is single-use on the server, so the
// sign-in screen must use a fresh one for every request. Before the fix "Send a new code" and a second
// password attempt re-sent the spent token and failed.
// Stand-ins, nothing leaves the machine: a fake Turnstile (each render hands out a new token) and a fake
// GoTrue that refuses a token it has already seen, as Cloudflare's siteverify does.
//   VITE_TURNSTILE_SITE_KEY=test bunx vite dev --port 5182 --strictPort   (then, with Playwright:)
//   PW=<dir with node_modules/playwright-core> bun tests/verify/p/captcha-tokens.ts
import { APP, UA, pw, sleep } from "./lib";

const FAKE_TURNSTILE = `window.turnstile = {
  n: 0,
  render(el, o) { const id = "w" + (++this.n); const tok = "tok-" + Math.random().toString(36).slice(2); el.dataset.token = tok; setTimeout(() => o.callback(tok), 30); return id; },
  remove() {},
};`;

const seen: string[] = [];
const refused: string[] = [];
let failed = false;
const check = (ok: boolean, text: string, got?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${text}${ok ? "" : `  got: ${JSON.stringify(got)}`}`);
  if (!ok) failed = true;
};

const browser = await pw.chromium.launch();
try {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await c.route("https://challenges.cloudflare.com/**", (r: any) =>
    r.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }),
  );
  // GoTrue: the code and password endpoints, with single-use captcha tokens
  await c.route(/\/auth\/v1\/(otp|token)/, async (r: any) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    const tok = body.gotrue_meta_security?.captcha_token ?? null;
    if (!tok || seen.includes(tok)) {
      refused.push(String(tok));
      return r.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: 400,
          error_code: "captcha_failed",
          msg: "captcha protection: request disallowed (timeout-or-duplicate)",
        }),
      });
    }
    seen.push(tok);
    if (/\/otp/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return r.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: 400,
        error_code: "invalid_credentials",
        msg: "Invalid login credentials",
      }),
    });
  });
  const p = await c.newPage();

  console.log("\nJoin: send a code, then ask for a new one");
  await p.goto(`${APP}/sign-in`);
  await p.getByLabel("Display name").fill("Captcha Fan");
  await p.getByRole("textbox", { name: "Email" }).fill("captcha-fan@example.test");
  await sleep(300);
  await p.getByRole("button", { name: "Send my code" }).click();
  await p.getByRole("button", { name: "Send a new code" }).waitFor();
  await sleep(300);
  await p.getByRole("button", { name: "Send a new code" }).click();
  await sleep(800);
  const alerts1 = await p.locator('[role="alert"]').allInnerTexts();
  check(
    seen.length === 2 && refused.length === 0,
    "both requests carried a fresh token and were accepted",
    {
      seen,
      refused,
    },
  );
  check(alerts1.length === 0, "no error on the screen after 'Send a new code'", alerts1);

  console.log("\nSign in with a password: a wrong password, then a second try");
  await p.goto(`${APP}/sign-in`);
  await p.getByRole("tab", { name: "I have an account" }).click();
  await p.getByRole("textbox", { name: "Email" }).fill("captcha-fan@example.test");
  await p.getByLabel("Password", { exact: true }).fill("not-the-password-1");
  await sleep(300);
  const verifyBtn = p.locator("form").getByRole("button", { name: "Sign in", exact: true });
  await verifyBtn.click();
  await sleep(600);
  await p.getByLabel("Password", { exact: true }).fill("not-the-password-2");
  await sleep(300);
  await verifyBtn.click();
  await sleep(800);
  const alerts2 = await p.locator('[role="alert"]').allInnerTexts();
  check(seen.length === 4 && refused.length === 0, "each attempt carried a fresh token", {
    seen,
    refused,
  });
  check(
    alerts2.some((a) => /password/i.test(a)) &&
      !alerts2.some((a) => /check above|went wrong/i.test(a)),
    "the second attempt is judged on the password, not refused for the captcha",
    alerts2,
  );
  await c.close();
} finally {
  await browser.close();
}
if (failed) {
  console.error("FAIL: a spent captcha token is sent again");
  process.exit(1);
}
console.log("\nall checks true");
