// Share cards (brief "bragging rights", Phase 3): a 1080×1350 PNG drawn with Canvas 2D, nothing from
// another origin (no player photos: they would also stop the canvas from exporting).
//   - "My Call": an open match the fan has picked. The pick's scoreboard, "What's your call?", and
//     when picks close, in Riyadh time.
//   - "I called it": a finished match where the fan picked the winner. Exact (every played set called
//     exactly), winner only (ticks under the exact sets), or void (retirement or walkover: winner only,
//     no ticks, and the void line). A rarity line only from get_my_call_stats (0020, 0024), only above the
//     minimum, and never for a majority pick: exact at 20% or less, winner at 40% or less.
// cardSpec() turns the game's data into the words and numbers on the card (pure, unit-tested);
// drawCard() paints it; cardPng() waits for the fonts and returns the PNG.
import type { CallStats, Match, Pick } from "./api";
import type { SetScore } from "./validation";

export type CardKind = "my_call" | "called_it";
export type CardVariant = "my_call" | "exact" | "winner" | "void";
export type { CallStats };
type Vars = Record<string, string | number>;
type T = (key: never, vars?: Vars) => string;
// The card's own keys; typed loosely here so the spec stays a pure function of any `t`.
type Tr = (key: string, vars?: Vars) => string;

export type CardSpec = {
  locale: "en" | "ar";
  variant: CardVariant;
  /** the game's name, word by word (the header wordmark: last word underneath, in gold) */
  brand: string[];
  chip: string | null;
  round: string;
  names: [string, string];
  winner: 1 | 2;
  sets: SetScore[];
  /** per set: show the EXACT tick under it */
  ticks: boolean[];
  exactLabel: string;
  headline: string;
  /** the closing time, the void line, the rarity line: in that order, any of them */
  lines: { text: string; tone: "gold" | "plain" }[];
  footerCta: string;
  code: string | null;
  host: string;
  fine: string;
  /** "PERFECT NIGHT" on an I-called-it card whose night the fan called perfectly (0022) */
  ribbon: string | null;
};

/** "7%" from the server's whole percentage (already rounded down); 0 means below 1%. */
export function shareText(pct: number, t: Tr): string {
  return pct < 1 ? t("pct_under_1") : `${pct}%`;
}

/**
 * Night 1, 2, 3: the event-local "session days" that have matches, in order. A night runs from 06:00
 * to 05:59 the next morning, event time, so a match that starts after midnight (00:30 Riyadh) belongs to
 * the evening it closes, as it does in public.match_nights() (0023).
 */
export const NIGHT_CUTOFF_HOURS = 6;
export function nightOf(m: Match, matches: Match[], timezone: string): number {
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(
      new Date(Date.parse(iso) - NIGHT_CUTOFF_HOURS * 3_600_000),
    );
  const days = [
    ...new Set(matches.filter((x) => x.starts_at).map((x) => day(x.starts_at!))),
  ].sort();
  return m.starts_at ? days.indexOf(day(m.starts_at)) + 1 : 0;
}

/** Every played set called exactly, on a completed match (settlement's flags, 0010). */
export function isExact(m: Match, p: Pick): boolean {
  const played = m.set_scores?.length ?? 0;
  return (
    m.status === "completed" &&
    played > 0 &&
    Array.from({ length: played }, (_, i) => p.exact_flags?.[i] === true).every(Boolean)
  );
}

/** "I called it" is offered for a scored pick on the winner (a void late pick scores 0: 0018). */
export const calledIt = (m: Match, p: Pick | undefined): p is Pick =>
  !!p &&
  m.status !== "scheduled" &&
  !!m.winner_id &&
  p.winner_id === m.winner_id &&
  (p.pts_winner ?? 0) > 0;

export function cardSpec(input: {
  kind: CardKind;
  match: Match;
  matches: Match[];
  pick: Pick;
  /** surnames, player 1 then player 2, in the card's language */
  names: [string, string];
  locale: "en" | "ar";
  t: Tr | T;
  timezone: string;
  brand: string[];
  stats: CallStats | null;
  /** the match's night is one of the fan's Perfect Nights (get_my_badges) */
  perfect?: boolean;
  code: string | null;
  host: string;
}): CardSpec {
  const { kind, match: m, matches, pick, names, locale, timezone, stats } = input;
  const t = input.t as Tr;
  const same = matches.filter((x) => x.round === m.round);
  const n = same.length > 1 ? same.findIndex((x) => x.match_no === m.match_no) + 1 : "";
  const night = nightOf(m, matches, timezone);
  const round = [
    t("match_label", { round: t(`round_${m.round}`), n }).trim(),
    night >= 1 && night <= 3 ? t(`night_${night}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const side = (id: string | null): 1 | 2 => (id === m.p2_id ? 2 : 1);
  const base = {
    locale,
    brand: input.brand,
    round,
    names,
    exactLabel: t("card_exact"),
    footerCta: input.code ? t("card_join") : t("card_play_free"),
    code: input.code,
    host: input.host,
    fine: t("card_fine"),
  };

  if (kind === "my_call") {
    const fmt = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
        timeZone: timezone,
        ...o,
      }).format(new Date(m.starts_at!));
    return {
      ...base,
      variant: "my_call",
      chip: t("card_my_call"),
      ribbon: null,
      winner: side(pick.winner_id),
      sets: pick.set_scores,
      ticks: [],
      headline: t("card_whats_yours"),
      lines: [
        {
          text: t("card_closes", {
            day: fmt({ weekday: "short", day: "numeric", month: "short" }),
            time: fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
          }),
          tone: "plain",
        },
      ],
    };
  }

  const variant: CardVariant =
    m.status === "retired" || m.status === "walkover"
      ? "void"
      : isExact(m, pick)
        ? "exact"
        : "winner";
  const sets = m.set_scores ?? [];
  const ticks =
    variant === "void"
      ? []
      : sets.map((_, i) => variant === "exact" || pick.exact_flags?.[i] === true);
  const lines: CardSpec["lines"] = [];
  if (variant === "void") lines.push({ text: t("card_void"), tone: "plain" });
  // The server decides what is rare (0024: exact score 20% or fewer, winner 40% or fewer, on exact
  // fractions) and sends whole percentages only.
  if (stats?.threshold_met) {
    const winnerName = names[side(m.winner_id) - 1] ?? "";
    if (variant === "exact" && stats.exact_rare && stats.exact_pct !== null)
      lines.push({
        text: t("card_rarity_exact", { share: shareText(stats.exact_pct, t) }),
        tone: "gold",
      });
    if (variant !== "exact" && stats.winner_rare && stats.winner_pct !== null)
      lines.push({
        text: t("card_rarity_winner", { share: shareText(stats.winner_pct, t), name: winnerName }),
        tone: "gold",
      });
  }
  return {
    ...base,
    variant,
    chip: null,
    ribbon: input.perfect ? t("card_perfect_ribbon") : null,
    winner: side(m.winner_id),
    sets,
    ticks,
    headline: variant === "exact" ? t("card_called_it") : t("card_called_winner"),
    lines,
  };
}

// ----------------------------------------------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------------------------------------------

export const CARD_W = 1080;
export const CARD_H = 1350;

type Tokens = Record<
  "bg" | "card" | "raised" | "text" | "text2" | "text3" | "gold" | "line" | "accent",
  string
>;
/** Colours come from the app's CSS tokens (styles.css, or the event's overrides). */
function tokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#0b0b0b"),
    card: v("--card", "#181818"),
    raised: v("--raised", "#242424"),
    text: v("--text", "#ffffff"),
    text2: v("--text-2", "#c9c9c9"),
    text3: v("--text-3", "#9c9c9c"),
    gold: v("--gold", "#f2c14e"),
    line: v("--line", "rgb(255 255 255 / 0.08)"),
    accent: v("--accent", "#b20710"),
  };
}

type Fonts = { head: string; num: string; body: string; headW: number; numW: number };
const FONTS: Record<"en" | "ar", Fonts> = {
  en: {
    head: '"Barlow Condensed", "Arial Narrow", sans-serif',
    num: '"Urbanist Variable", "Urbanist", system-ui, sans-serif',
    body: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif',
    headW: 700,
    numW: 700,
  },
  ar: {
    head: '"Noto Kufi Arabic", sans-serif',
    num: '"Noto Kufi Arabic", sans-serif',
    body: '"Noto Kufi Arabic", sans-serif',
    headW: 800,
    numW: 700,
  },
};

const allText = (s: CardSpec) =>
  [
    ...s.brand,
    s.chip ?? "",
    s.round,
    ...s.names,
    s.exactLabel,
    s.headline,
    ...s.lines.map((l) => l.text),
    s.footerCta,
    s.code ?? "",
    s.host,
    s.fine,
    "0123456789%·",
  ].join(" ");

/** The Arabic font only for an Arabic card; then every family and weight the card uses. */
export async function loadCardFonts(spec: CardSpec): Promise<void> {
  if (spec.locale === "ar") {
    await Promise.all([
      import("@fontsource/noto-kufi-arabic/500.css"),
      import("@fontsource/noto-kufi-arabic/700.css"),
      import("@fontsource/noto-kufi-arabic/800.css"),
    ]);
  }
  const f = FONTS[spec.locale];
  const text = allText(spec);
  const faces =
    spec.locale === "ar"
      ? [`500 40px ${f.body}`, `700 40px ${f.num}`, `800 40px ${f.head}`]
      : [
          `700 40px ${f.head}`,
          `600 40px ${f.head}`,
          `700 40px ${f.num}`,
          `500 40px ${f.body}`,
          `600 40px ${f.body}`,
          `700 40px ${f.body}`,
        ];
  await Promise.all(faces.map((face) => document.fonts.load(face, text)));
}

/** Paint the card. Right to left for Arabic: the whole layout mirrors, so set 1 sits on the right. */
export function drawCard(canvas: HTMLCanvasElement, s: CardSpec): void {
  const c = tokens();
  const f = FONTS[s.locale];
  const rtl = s.locale === "ar";
  const upper = (x: string) => (rtl ? x : x.toUpperCase());
  const W = CARD_W;
  const H = CARD_H;
  const PAD = 84;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "alphabetic";
  /** an x measured from the start edge (left in English, right in Arabic) */
  const X = (x: number) => (rtl ? W - x : x);
  const font = (weight: number, size: number, family: string) =>
    (ctx.font = `${weight} ${size}px ${family}`);
  /** the largest size up to `size` at which the text fits `max` wide */
  const fit = (text: string, weight: number, size: number, family: string, max: number) => {
    let px = size;
    font(weight, px, family);
    while (px > 24 && ctx.measureText(text).width > max) font(weight, (px -= 2), family);
    return px;
  };
  const wrap = (text: string, max: number) => {
    const words = text.split(" ");
    const out: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > max) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const text = (
    t: string,
    x: number,
    y: number,
    color: string,
    align: CanvasTextAlign = "start",
  ) => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  };
  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  // Background, with a gold glow from the top corner that fades to nothing inside the card.
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(X(W * 0.82), 40, 0, X(W * 0.82), 40, 820);
  glow.addColorStop(0, withAlpha(c.gold, 0.2));
  glow.addColorStop(0.55, withAlpha(c.gold, 0.06));
  glow.addColorStop(1, withAlpha(c.gold, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The game's mark and name, as in the header.
  const markSize = 104;
  drawMark(ctx, rtl ? W - PAD - markSize : PAD, 64, markSize, c);
  const top = s.brand.slice(0, -1).join(" ");
  const last = s.brand.slice(-1)[0] ?? "";
  const nameX = X(PAD + markSize + 22);
  font(f.headW, 58, f.head);
  text(upper(top), nameX, 118, c.text);
  const topW = ctx.measureText(upper(top)).width;
  font(f.headW, 40, f.head);
  if (rtl) text(last, nameX - topW / 2, 166, c.gold, "center");
  else {
    // the last word spread to the width of the line above, as in the header
    const letters = [...upper(last)];
    const step =
      letters.length > 1
        ? (topW - ctx.measureText(letters.at(-1)!).width) / (letters.length - 1)
        : 0;
    letters.forEach((ch, i) => text(ch, nameX + i * step, 166, c.gold, "left"));
  }

  // Perfect Night: a gold ribbon at the other end of the top row from the name.
  if (s.ribbon) {
    font(f.headW, rtl ? 32 : 36, f.head);
    const label = upper(s.ribbon);
    ctx.letterSpacing = rtl ? "0px" : "4px";
    const w = ctx.measureText(label).width + 56;
    const rx = rtl ? PAD : W - PAD - w;
    roundRect(rx, 86, w, 64, 32);
    ctx.fillStyle = c.gold;
    ctx.fill();
    ctx.direction = "ltr";
    text(label, rx + w / 2 + (rtl ? 0 : 2), 131, c.bg, "center");
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.letterSpacing = "0px";
  }

  // Chip, round line, headline.
  let y = 270;
  if (s.chip) {
    font(f.headW, 40, f.head);
    const label = upper(s.chip);
    ctx.letterSpacing = rtl ? "0px" : "6px";
    const w = ctx.measureText(label).width + 64;
    roundRect(rtl ? W - PAD - w : PAD, y - 50, w, 72, 36);
    ctx.fillStyle = withAlpha(c.gold, 0.12);
    ctx.fill();
    ctx.strokeStyle = c.gold;
    ctx.lineWidth = 3;
    ctx.stroke();
    text(label, X(PAD + 32 + (rtl ? 0 : 3)), y + 1, c.gold);
    ctx.letterSpacing = "0px";
    y += 92;
  }
  font(600, 34, f.body);
  ctx.letterSpacing = rtl ? "0px" : "3px";
  text(upper(s.round), X(PAD), y, c.text2);
  ctx.letterSpacing = "0px";
  y += 30;

  if (s.variant !== "my_call") {
    const head = upper(s.headline);
    const px = fit(head, f.headW, rtl ? 120 : 150, f.head, W - 2 * PAD);
    text(head, X(PAD), y + px * 0.92, c.text);
    y += px + 34;
  } else y += 26;

  // The scoreboard: one row per player (player 1 on top), a column per set.
  const cols = Math.max(s.sets.length, 2);
  const colW = 128;
  const boardX = PAD;
  const boardW = W - 2 * PAD;
  const rowH = 150;
  const tickH = s.ticks.some(Boolean) ? 76 : 0;
  const boardH = 2 * rowH + 40 + tickH;
  roundRect(boardX, y, boardW, boardH, 40);
  ctx.fillStyle = c.card;
  ctx.fill();
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  // set columns sit at the end side; set 1 is the one nearest the names
  const colCenter = (i: number) => X(boardX + boardW - 36 - (cols - i - 0.5) * colW);
  const nameStart = boardX + 40 + 30 + 20;
  const nameMax = boardW - 40 - 30 - 20 - cols * colW - 50;
  ([1, 2] as const).forEach((side, r) => {
    const rowY = y + 20 + r * rowH;
    const mid = rowY + rowH / 2;
    const won = s.winner === side;
    if (r === 1) {
      ctx.fillStyle = c.line;
      ctx.fillRect(boardX + 32, rowY, boardW - 64, 2);
    }
    if (won) {
      ctx.beginPath();
      ctx.arc(X(boardX + 40 + 15), mid - 4, 13, 0, Math.PI * 2);
      ctx.fillStyle = c.gold;
      ctx.fill();
    }
    const name = upper(s.names[side - 1] ?? "");
    const px = fit(name, f.headW, rtl ? 66 : 84, f.head, nameMax);
    text(name, X(nameStart), mid + px * (rtl ? 0.2 : 0.34), won ? c.text : c.text3);
    s.sets.forEach((set, i) => {
      const mine = side === 1 ? set.p1_games : set.p2_games;
      const theirs = side === 1 ? set.p2_games : set.p1_games;
      font(f.numW, 92, f.num);
      ctx.direction = "ltr";
      text(String(mine), colCenter(i), mid + 32, mine > theirs ? c.text : c.text3, "center");
      ctx.direction = rtl ? "rtl" : "ltr";
    });
    for (let i = s.sets.length; i < cols; i++) {
      font(f.numW, 60, f.num);
      text("–", colCenter(i), mid + 20, c.text3, "center");
    }
  });
  if (tickH) {
    const ty = y + 20 + 2 * rowH + 44;
    s.ticks.forEach((on, i) => {
      if (!on) return;
      const cx = colCenter(i);
      font(700, 22, f.body);
      ctx.letterSpacing = rtl ? "0px" : "1px";
      const label = s.exactLabel;
      const w = ctx.measureText(label).width + 30;
      // the tick leads the word: on its left in English, on its right in Arabic
      drawTick(ctx, rtl ? cx + w / 2 - 22 : cx - w / 2 + 2, ty - 10, 20, c.gold);
      text(label, rtl ? cx + w / 2 - 30 : cx - w / 2 + 30, ty, c.gold, rtl ? "right" : "left");
      ctx.letterSpacing = "0px";
    });
  }
  y += boardH + 70;

  // Below the board: "What's your call?" and the closing time, or the void and rarity lines.
  if (s.variant === "my_call") {
    const head = upper(s.headline);
    const px = fit(head, f.headW, rtl ? 86 : 104, f.head, W - 2 * PAD);
    text(head, X(PAD), y + px * 0.8, c.gold);
    y += px + 30;
  }
  for (const line of s.lines) {
    const gold = line.tone === "gold";
    font(gold ? 700 : 500, gold ? 42 : 34, f.body);
    for (const part of wrap(line.text, W - 2 * PAD)) {
      text(part, X(PAD), y + (gold ? 40 : 34), gold ? c.gold : c.text2);
      y += gold ? 60 : 50;
    }
    y += 14;
  }

  // Footer: the league to join (or "Play free"), the address, the fine print. The address goes at
  // the far end of the CTA line, smaller if it has to; when even that would run into the league
  // code, it gets a line of its own and the footer moves up (full-debug G1).
  font(700, 40, f.body);
  const ctaW = ctx.measureText(s.footerCta).width;
  let codeW = 0;
  if (s.code) {
    font(f.numW, 40, f.num);
    ctx.letterSpacing = "6px";
    codeW = ctx.measureText(s.code).width;
    ctx.letterSpacing = "0px";
  }
  const room = W - 2 * PAD - ctaW - (s.code ? 26 + codeW : 0) - 32;
  ctx.direction = "ltr";
  let hostPx = fit(s.host, 500, 32, f.body, room);
  const ownLine = ctx.measureText(s.host).width > room;
  if (ownLine) hostPx = fit(s.host, 500, 32, f.body, W - 2 * PAD);
  ctx.direction = rtl ? "rtl" : "ltr";
  const footY = H - (ownLine ? 260 : 210);
  ctx.fillStyle = c.line;
  ctx.fillRect(PAD, footY, W - 2 * PAD, 2);
  font(700, 40, f.body);
  text(s.footerCta, X(PAD), footY + 82, c.text);
  if (s.code) {
    font(f.numW, 40, f.num);
    ctx.direction = "ltr";
    ctx.letterSpacing = "6px";
    text(s.code, X(PAD + ctaW + 26), footY + 82, c.gold, rtl ? "right" : "left");
    ctx.letterSpacing = "0px";
    ctx.direction = rtl ? "rtl" : "ltr";
  }
  font(500, hostPx, f.body);
  ctx.direction = "ltr";
  if (ownLine) text(s.host, X(PAD), footY + 140, c.text2, rtl ? "right" : "left");
  else text(s.host, X(W - PAD), footY + 82, c.text2, rtl ? "left" : "right");
  ctx.direction = rtl ? "rtl" : "ltr";
  font(500, 28, f.body);
  text(s.fine, X(PAD), footY + (ownLine ? 200 : 150), c.text3);
}

/** The PNG, once the fonts are in. */
export async function cardPng(spec: CardSpec): Promise<Blob> {
  await loadCardFonts(spec);
  const canvas = document.createElement("canvas");
  drawCard(canvas, spec);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas export failed"))), "image/png"),
  );
}

/** A CSS colour with a new alpha: "#f2c14e" → "rgb(242 193 78 / 0.2)". */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const n = parseInt(hex, 16);
    return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? `rgb(${rgb[1]} ${rgb[2]} ${rgb[3]} / ${alpha})` : color;
}

/** The crowned ball (the header's mark, AppShell Wordmark), at (x, y), `size` wide. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, c: Tokens) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.arc(50, 60, 34, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4.5;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M23 37 C41 51 41 69 23 83"));
  ctx.stroke(new Path2D("M77 37 C59 51 59 69 77 83"));
  ctx.translate(50, 18);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.translate(-50, -18);
  ctx.fillStyle = c.gold;
  ctx.fill(new Path2D("M31 30 L31 12 L39 22 L50 6 L61 22 L69 12 L69 30 Z"));
  ctx.beginPath();
  ctx.roundRect(30, 29.5, 40, 5.5, 1.5);
  ctx.fill();
  ctx.restore();
}

/** A tick drawn as a stroke (no font needed), `size` wide, its box's top-left at (x, y). */
function drawTick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.55);
  ctx.lineTo(x + size * 0.38, y + size * 0.9);
  ctx.lineTo(x + size, y + size * 0.1);
  ctx.stroke();
  ctx.restore();
}
