// P6: controls without an accessible name, icon-only controls, form fields without a label, images
// without alt, on every screen and sheet (audit, 5 Oct 2026). EN and AR at 390 px, signed in as A.
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/a11y-scan.ts
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
const browser = await pw.chromium.launch();
const out: Record<string, unknown> = {};
const session = await passwordSession(U.users.a.email, U.password);
for (const lang of ["en", "ar"] as const) {
  for (const signed of [true, false]) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    await wire(c, newLog());
    if (lang === "ar") await forceArabicFlag(c);
    if (signed) await signedInInit(c, session, lang);
    else await c.addInitScript((l: string) => localStorage.setItem("locale", l), lang);
    const p = await c.newPage();
    const urls = signed
      ? [
          "/",
          "/picks",
          "/picks?match=1",
          "/results",
          "/standings",
          `/standings?league=${U.league.id}`,
          `/standings?join=${U.league.code}`,
          "/profile",
          "/how-to-play",
        ]
      : ["/", "/sign-in", "/picks", "/results", "/standings", "/profile", "/how-to-play", "/nope"];
    for (const u of urls) {
      await p.goto(`${APP}${u}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      await sleep(500);
      out[`${lang} ${signed ? "in" : "out"} ${u}`] = await p.evaluate(() => {
        const name = (el: Element) => {
          const l = el.getAttribute("aria-label");
          if (l) return l.trim();
          const by = el.getAttribute("aria-labelledby");
          if (by)
            return by
              .split(" ")
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
              .trim();
          if (el instanceof HTMLInputElement && el.labels?.length)
            return [...el.labels]
              .map((x) => x.textContent)
              .join(" ")
              .trim();
          if (el instanceof HTMLImageElement) return el.alt;
          return (el as HTMLElement).innerText?.trim() ?? "";
        };
        const issues: string[] = [];
        for (const el of document.querySelectorAll(
          "button, a[href], input, select, textarea, [role=tab], [role=button]",
        )) {
          const n = name(el);
          const tag = `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""}`;
          if (!n) issues.push(`no name: ${tag} ${el.outerHTML.slice(0, 120)}`);
          else if (/^[^\p{L}\p{N}]{1,3}$/u.test(n)) issues.push(`symbol-only name "${n}": ${tag}`);
        }
        for (const img of document.querySelectorAll("img"))
          if (!img.hasAttribute("alt")) issues.push(`img without alt ${img.src.slice(0, 60)}`);
        const tablists = [...document.querySelectorAll("[role=tablist]")].map((tl) => {
          const tabs = tl.querySelectorAll("[role=tab]");
          const withControls = [...tabs].filter((t) => t.hasAttribute("aria-controls")).length;
          return `${tabs.length} tabs, ${withControls} with aria-controls, panels: ${document.querySelectorAll("[role=tabpanel]").length}`;
        });
        return {
          issues: [...new Set(issues)],
          tablists,
          h1: document.querySelectorAll("h1").length,
          lang: document.documentElement.lang,
        };
      });
    }
    await c.close();
  }
}
await browser.close();
writeFileSync(path.join(import.meta.dirname, "out-a11y.json"), JSON.stringify(out, null, 2));
const agg: Record<string, string[]> = {};
for (const [k, v] of Object.entries(out) as [
  string,
  { issues: string[]; tablists: string[]; h1: number },
][]) {
  for (const i of v.issues) (agg[i] ||= []).push(k);
  if (v.h1 !== 1) (agg[`h1 count ${v.h1}`] ||= []).push(k);
  for (const t of v.tablists) (agg[`tablist: ${t}`] ||= []).push(k);
}
for (const [k, v] of Object.entries(agg))
  console.log(`${k}\n    on ${v.length}: ${v.slice(0, 4).join(" | ")}`);
