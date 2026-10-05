import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CARD_H, CARD_W, drawCard, type CardSpec } from "../src/lib/callCard";

// full-debug G1: the footer draws "Join my league" + the league code from the start edge and the
// address from the far edge. Nothing stopped the two from running into each other with a wide code
// (codes come from A-Z and 2-9, so WMWMWM is possible) and a longer address. A stand-in 2D context
// (Bun has no canvas) measures text with fixed per-character widths and records every fillText.

type Drawn = {
  text: string;
  x: number;
  y: number;
  size: number;
  align: string;
  dir: string;
  spacing: number;
};

const charW = (ch: string, size: number) => size * (/[WM]/.test(ch) ? 0.9 : 0.55);
const widthOf = (d: Pick<Drawn, "text" | "size" | "spacing">) =>
  [...d.text].reduce((w, ch) => w + charW(ch, d.size) + d.spacing, 0);

function fakeCanvas() {
  const drawn: Drawn[] = [];
  const state: Record<string, unknown> = { font: "10px x", letterSpacing: "0px", direction: "ltr" };
  const size = () => Number(/(\d+)px/.exec(String(state["font"]))?.[1] ?? 10);
  const spacing = () => parseFloat(String(state["letterSpacing"])) || 0;
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText")
        return (text: string) => ({ width: widthOf({ text, size: size(), spacing: spacing() }) });
      if (key === "fillText")
        return (text: string, x: number, y: number) =>
          drawn.push({
            text,
            x,
            y,
            size: size(),
            align: String(target["textAlign"] ?? "start"),
            dir: String(target["direction"]),
            spacing: spacing(),
          });
      if (key === "createRadialGradient" || key === "createLinearGradient")
        return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return () => {}; // every other drawing call does nothing here
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, drawn };
}

/** [left, right] of a drawn string, from its anchor, alignment and direction. */
function span(d: Drawn): [number, number] {
  const w = widthOf(d);
  const left =
    d.align === "left" ||
    (d.align === "start" && d.dir === "ltr") ||
    (d.align === "end" && d.dir === "rtl");
  return left ? [d.x, d.x + w] : [d.x - w, d.x];
}

const g = globalThis as Record<string, unknown>;
const saved = ["document", "getComputedStyle", "Path2D"].map((k) => [k, g[k]] as const);
beforeAll(() => {
  g["document"] = { documentElement: {} };
  g["getComputedStyle"] = () => ({ getPropertyValue: () => "" });
  g["Path2D"] = class {};
});
afterAll(() => {
  for (const [k, v] of saved) g[k] = v;
});

const spec = (locale: "en" | "ar", host: string, code: string | null): CardSpec => ({
  locale,
  variant: "my_call",
  brand: ["Call", "the", "Crown"],
  chip: "MY CALL",
  round: "Semi-final 1 · Night 2",
  names: ["Alder", "Fenwick"],
  winner: 1,
  sets: [
    { p1_games: 6, p2_games: 4 },
    { p1_games: 6, p2_games: 3 },
  ],
  ticks: [],
  exactLabel: "EXACT",
  headline: "What's your call?",
  lines: [{ text: "Picks close Thu 22 Oct · 19:30 Riyadh time", tone: "plain" }],
  footerCta: code ? (locale === "ar" ? "انضم إلى دوري" : "Join my league") : "Play free",
  code,
  host,
  fine: "Free to play. No money, no betting.",
  ribbon: null,
});

describe("card footer: nothing overlaps, nothing leaves the margins", () => {
  const hosts = ["callthecrown.example", "callthecrown.grandslamgm.com", "localhost:5173"];
  for (const locale of ["en", "ar"] as const)
    for (const host of hosts)
      for (const code of ["WMWMWM", "K7Q2PX", null])
        test(`${locale}, ${host}, code ${code ?? "none"}`, () => {
          const { canvas, drawn } = fakeCanvas();
          const s = spec(locale, host, code);
          drawCard(canvas, s);
          const foot = drawn.filter((d) => [s.footerCta, s.code, s.host, s.fine].includes(d.text));
          expect(foot.length).toBe(code ? 4 : 3);
          for (const d of foot) {
            const [l, r] = span(d);
            expect(l).toBeGreaterThanOrEqual(84 - 0.5); // the card's side margins
            expect(r).toBeLessThanOrEqual(CARD_W - 84 + 0.5);
            expect(d.y).toBeLessThanOrEqual(CARD_H - 40);
          }
          for (let i = 0; i < foot.length; i++)
            for (let j = i + 1; j < foot.length; j++) {
              const [a, b] = [foot[i]!, foot[j]!];
              const lines = Math.abs(a.y - b.y) >= Math.max(a.size, b.size);
              const [al, ar] = span(a);
              const [bl, br] = span(b);
              const apart = Math.max(bl - ar, al - br) >= 16;
              expect({ a: a.text, b: b.text, ok: lines || apart }).toEqual({
                a: a.text,
                b: b.text,
                ok: true,
              });
            }
        });
});
