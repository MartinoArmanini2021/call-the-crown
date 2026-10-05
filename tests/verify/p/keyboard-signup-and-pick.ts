// P6 + P5 + L (real UI sign-up), audit 5 Oct 2026. Keyboard only: Join with the email code read from
// Mailpit, set a password, then make a pick with Tab/Enter/Space. Records the Tab path, console errors,
// analytics events (PostHog fulfilled locally) and whether focus ever leaves the pick sheet.
//   PW=<scratch> ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/keyboard-signup-and-pick.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { APP, SCREENS, UA, newLog, pw, sleep, wire } from "./lib";

const email = `p-kb${Date.now() % 100000}@example.test`;
const log = newLog();
const tabPath: string[] = [];
const findings: string[] = [];

async function mailCode(to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(
      `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`,
    );
    const j = (await r.json()) as { messages?: { ID: string }[] };
    const id = j.messages?.[0]?.ID;
    if (id) {
      const m = (await (await fetch(`http://127.0.0.1:55324/api/v1/message/${id}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const code = /\b(\d{6})\b/.exec(m.Text || m.HTML)?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error("no code mail");
}

const browser = await pw.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  timezoneId: "Europe/Madrid",
  userAgent: UA,
});
await wire(context, log);
const page = await context.newPage();

const active = () =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "<body>";
    const name =
      el.getAttribute("aria-label") ||
      el.innerText?.trim().slice(0, 40) ||
      (el as HTMLInputElement).placeholder ||
      "";
    const visible = getComputedStyle(el).outlineStyle !== "none";
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${name}"${visible ? "" : " (NO focus outline)"}`;
  });

async function tabTo(re: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const a = await active();
    tabPath.push(a);
    if (re.test(a)) return a;
  }
  throw new Error(`Tab never reached ${re} (path: ${tabPath.slice(-max).join(" → ")})`);
}

await page.goto(`${APP}/`);
await page.waitForSelector("h1");
tabPath.push("--- landing");
await tabTo(/Play free/);
await page.keyboard.press("Enter");
await page.waitForURL(/sign-in/);
await page.waitForSelector("form");
tabPath.push("--- sign-in");
await tabTo(/Display name/i);
await page.keyboard.type("Pee Kay");
await tabTo(/Email/i);
await page.keyboard.type(email);
await tabTo(/Send my code/);
await page.keyboard.press("Enter");
await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 15000 });
tabPath.push("--- code (autofocus: " + (await active()) + ")");
const code = await mailCode(email);
await page.keyboard.type(code);
await page.keyboard.press("Enter");
await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 15000 });
tabPath.push("--- password (autofocus: " + (await active()) + ")");
await page.keyboard.type("audit-Keyboard-only-9271");
await page.keyboard.press("Enter");
await page.waitForURL(/\/picks/, { timeout: 15000 });
await page.waitForSelector("article", { timeout: 15000 });
tabPath.push("--- picks");
await tabTo(/Make pick/);
await page.keyboard.press("Enter");
await page.waitForSelector('[role="dialog"]');
tabPath.push("--- sheet (initial focus: " + (await active()) + ")");

// focus trap: 60 Tabs must stay inside the dialog; and is the page behind inert?
let escaped = 0;
for (let i = 0; i < 60; i++) {
  await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  if (!inside) escaped++;
}
const inert = await page.evaluate(() => {
  const dialogRoot = document.querySelector('[role="dialog"]')!.closest(".fixed")!;
  const others = [...document.querySelectorAll("header, main, nav")].filter(
    (e) => !dialogRoot.contains(e),
  );
  return others.map(
    (e) =>
      `${e.tagName.toLowerCase()} inert=${(e as HTMLElement).inert} aria-hidden=${e.getAttribute("aria-hidden")}`,
  );
});
if (escaped) findings.push(`focus left the pick sheet ${escaped}/60 Tabs`);
findings.push(`page behind the sheet: ${inert.join(", ")}`);

// make the pick with the keyboard: choose player 1 (CourtPicker), then a format and scores
await page.keyboard.press("Shift+Tab"); // back to a known point is unreliable; restart from the top of the dialog
const dialogButtons = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] button')].map((b) =>
    (b.getAttribute("aria-label") || (b as HTMLElement).innerText)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 50),
  ),
);
writeFileSync(
  path.join(SCREENS, "..", "p", "out-sheet-buttons.json"),
  JSON.stringify(dialogButtons, null, 2),
);
// press the first player button via Tab until its label matches a player name tile
const playerBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (x) =>
      x.getAttribute("aria-pressed") !== null &&
      !/Set|close/i.test(x.getAttribute("aria-label") ?? ""),
  );
  return b ? (b.getAttribute("aria-label") || b.innerText).trim().slice(0, 40) : null;
});
tabPath.push(`--- choose winner (${playerBtn})`);
if (playerBtn) {
  await tabTo(new RegExp(playerBtn.split(/\s+/)[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await page.keyboard.press("Enter");
}
await sleep(300);
// whatever CourtPicker shows next (format choice), then the first legal chip for each set
for (let guard = 0; guard < 8; guard++) {
  const saveEnabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (x) => /Save/.test(x.innerText),
    );
    return b ? !b.disabled : false;
  });
  if (saveEnabled) break;
  const next = await page.evaluate(() => {
    const btns = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not([disabled])'),
    ];
    const fmt = btns.find(
      (b) => /^2 sets|2 sets/i.test(b.innerText) && b.getAttribute("aria-pressed") !== "true",
    );
    if (fmt) return fmt.innerText.trim().split("\n")[0];
    const chip = btns.find(
      (b) =>
        /^Set \d+:/.test(b.getAttribute("aria-label") ?? "") &&
        b.getAttribute("aria-pressed") === "false" &&
        /6-4/.test(b.innerText),
    );
    const groups = new Set(
      [...document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')].map((b) =>
        (b.getAttribute("aria-label") ?? "").slice(0, 6),
      ),
    );
    if (chip && !groups.has((chip.getAttribute("aria-label") ?? "").slice(0, 6)))
      return chip.getAttribute("aria-label");
    return null;
  });
  if (!next) break;
  tabPath.push(`--- target ${next}`);
  await tabTo(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 60);
  await page.keyboard.press("Space");
  await sleep(200);
}
await tabTo(/Save/, 80);
await page.keyboard.press("Enter");
const toast = await page.waitForSelector('[role="status"]', { timeout: 10000 }).then(
  (e: { innerText: () => Promise<string> }) => e.innerText(),
  () => null,
);
tabPath.push(`--- saved toast: ${toast}`);
await page.screenshot({ path: path.join(SCREENS, "keyboard-pick-saved-en-390.png") });
await sleep(2500); // let posthog flush
await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
await sleep(500);
await browser.close();

const out = {
  email,
  toast,
  findings,
  tabPath,
  console: log.console,
  blocked: log.blocked,
  posthog: log.posthog,
};
writeFileSync(path.join(import.meta.dirname, "out-keyboard.json"), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      toast,
      findings,
      events: log.posthog.map((e) => e.event),
      console: log.console.length,
      blocked: log.blocked.length,
    },
    null,
    2,
  ),
);
