// P1 RTL checks on Standings in Arabic (audit, 5 Oct 2026), with a 137-row board from a fixture:
//   - the page range "1–50 من 137" must read 1 then 50 (bidi: the en dash between two numbers in an RTL
//     paragraph reverses them to "50–1");
//   - the "next" / "previous" arrows must point the reading direction (← for next in Arabic);
//   - a long Latin name must keep its first letters (truncation must cut the end, not the start).
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/rtl-check.ts      (FAILS today)
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  API,
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
const s = await passwordSession(U.users.a.email, U.password);
const b = await pw.chromium.launch();
const c = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 } });
await wire(c, newLog());
await forceArabicFlag(c);
await signedInInit(c, s, "ar");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await c.route(`${API}/rest/v1/rpc/get_leaderboard`, async (route: any) => {
  const a = JSON.parse(route.request().postData() ?? "{}");
  const out = [];
  for (let i = a.p_offset + 1; i <= Math.min(137, a.p_offset + a.p_limit); i++)
    out.push({
      pos: i,
      global_rank: i,
      user_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      display_name: "Maximilian-Alexander Featherstonehaugh",
      points: 200 - i,
      exact_sets: 3,
      is_me: false,
      total: 137,
    });
  return route.fulfill({ json: out });
});
const p = await c.newPage();
await p.goto(`${APP}/standings`);
await p.waitForLoadState("networkidle");
await sleep(800);
const r = await p.evaluate(() => {
  const span = [...document.querySelectorAll("span")].find(
    (x) => /137/.test(x.textContent ?? "") && /–/.test(x.textContent ?? ""),
  )!;
  const node = span.firstChild as Text;
  const t = node.textContent!;
  const rect = (i: number, n: number) => {
    const rg = document.createRange();
    rg.setStart(node, i);
    rg.setEnd(node, i + n);
    return rg.getBoundingClientRect().left;
  };
  const one = rect(t.indexOf("1"), 1);
  const fifty = rect(t.indexOf("50"), 2);
  const next =
    [...document.querySelectorAll("button")].find((x) => /التالي/.test(x.textContent ?? ""))
      ?.textContent ?? "";
  const cell = document.querySelector("tbody tr td:nth-child(2)") as HTMLElement;
  const rg = document.createRange();
  rg.selectNodeContents(cell);
  const nameStartVisible = (() => {
    // the first letters ("Max…") must lie inside the cell
    const tn = cell.firstChild as Text;
    const r0 = document.createRange();
    r0.setStart(tn, 0);
    r0.setEnd(tn, 3);
    const a = r0.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    return a.left >= box.left - 1 && a.right <= box.right + 1;
  })();
  return { text: t, oneLeftOfFifty: one < fifty, next, nameStartVisible };
});
await b.close();
console.log(r);
const fails = [];
if (!r.oneLeftOfFifty) fails.push(`page range reads "50–1": ${r.text}`);
if (/→/.test(r.next)) fails.push(`"next" arrow points right in Arabic: ${r.next}`);
if (!r.nameStartVisible) fails.push("a long Latin name loses its first letters in RTL");
if (fails.length) {
  console.error("FAIL\n" + fails.join("\n"));
  process.exit(1);
}
