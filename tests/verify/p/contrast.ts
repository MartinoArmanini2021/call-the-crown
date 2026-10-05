// P6: WCAG contrast of the text tokens on the dark surfaces, read from src/styles.css (audit, 5 Oct 2026).
//   bun tests/verify/p/contrast.ts
// Fails (exit 1) when a pair the app really uses for body text is under 4.5:1 (normal text, AA).
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(import.meta.dirname, "../../../src/styles.css"), "utf8");
const root = /:root\s*{([^}]*)}/.exec(css)![1]!;
const tok: Record<string, string> = {};
for (const m of root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) tok[m[1]!] = m[2]!;

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]: number[]) => {
  const c = [r!, g!, b!].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const mix = (fg: number[], bg: number[], a: number) =>
  fg.map((v, i) => Math.round(v * a + bg[i]! * (1 - a)));
const ratio = (fg: number[], bg: number[]) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
};

type Row = { fg: string; bg: string; alpha?: number; where: string; large?: boolean };
const rows: Row[] = [
  { fg: "text-3", bg: "bg", where: "muted text on the page (landing links, hints)" },
  { fg: "text-3", bg: "card", where: "muted text in cards (labels, 'exact' column, draw hint)" },
  {
    fg: "text-3",
    bg: "raised",
    where: "muted text on raised chips/tiles (world rank, set toggles)",
  },
  { fg: "text-2", bg: "card", where: "secondary text in cards" },
  { fg: "text-2", bg: "raised", where: "set-score chips (unselected)" },
  { fg: "accent-text", bg: "card", where: "errors, countdowns, 'your pick' in cards" },
  { fg: "accent-text", bg: "bg", where: "countdown on the landing / errors on the page" },
  { fg: "text", bg: "accent", where: "white label on red buttons (Save, Make pick)" },
  { fg: "good", bg: "card", where: "'✓ +points', saved toast" },
  { fg: "gold", bg: "card", where: "final card, upset badge" },
  {
    fg: "text-3",
    bg: "card",
    alpha: 0.45,
    where: "loser row in the draw (opacity-45) — names/rank",
  },
  {
    fg: "text",
    bg: "card",
    alpha: 0.45,
    where: "loser row in the draw (opacity-45) — name in ink",
  },
  {
    fg: "text",
    bg: "accent",
    alpha: 0.4,
    where: "disabled red button (opacity-40), e.g. Send my code before a name",
  },
  { fg: "text-3", bg: "bg", alpha: 0.5, where: "inactive carousel dots (ink-3/50) — non-text" },
];
let fail = 0;
console.log("pair".padEnd(30), "ratio", " AA", " where");
for (const r of rows) {
  const bg = rgb(tok[r.bg]!);
  // opacity on the element: both fg and its own background fade into the parent; approximate with fg over bg
  const fg = r.alpha ? mix(rgb(tok[r.fg]!), bg, r.alpha) : rgb(tok[r.fg]!);
  const v = ratio(fg, bg);
  const ok = v >= 4.5;
  const exempt = /disabled|non-text/.test(r.where);
  if (!ok && !exempt) fail++;
  console.log(
    `${r.fg}${r.alpha ? `@${r.alpha}` : ""} on ${r.bg}`.padEnd(30),
    v.toFixed(2).padStart(5),
    ok ? " ok " : exempt ? " (exempt)" : " FAIL",
    r.where,
  );
}
process.exit(fail ? 1 : 0);
