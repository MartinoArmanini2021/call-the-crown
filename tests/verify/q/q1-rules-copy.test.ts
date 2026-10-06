// Q1 — the rules agree everywhere (full-debug brief, Part 2, section Q1).
// Locks the numbers in How to play / the landing page (EN and AR) to event_config.rules and to what the
// scoring SQL actually pays. Independent arithmetic here: nothing imports app scoring code.
// Tests whose name starts with "BUG" or "SMELL" demonstrate a finding and FAIL today, on purpose.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ar } from "../../../src/i18n/ar";
import { en, type StringKey } from "../../../src/i18n/strings";
import { ROOT, freshDb, loadRealDraw, one, uid } from "./_db";

// What the brief (section Q1) says the rules are.
const BRIEF = {
  winner_points: { QF: 8, SF: 13, "3P": 8, F: 20 },
  sets_points: { QF: 4, SF: 6, "3P": 4, F: 10 },
  per_set_exact: 2,
  upset_constant: 30,
};
const ROUNDS = ["QF", "SF", "3P", "F"] as const;
type Round = (typeof ROUNDS)[number];
type Rules = typeof BRIEF & { allowed_set_scores: number[][]; deciding_set: string };

// "rounded to a whole point (halves round up)", in exact rational arithmetic.
function upset(base: number, gap: number, k: number): number {
  if (gap <= 0) return base;
  const num = base * (2 * gap + k); // base · (1 + gap/(gap+k)) = base·(2gap+k)/(gap+k)
  const den = gap + k;
  const q = Math.floor(num / den);
  return 2 * (num - q * den) >= den ? q + 1 : q;
}

const src = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

let db: PGlite;
let rules: Rules;
beforeAll(async () => {
  db = await freshDb();
  rules = await one<Rules>(db, "select rules from public.event_config");
});
afterAll(async () => db?.close());

describe("Q1 event_config.rules = the brief", () => {
  test("winner points, set points, per exact set, upset constant", () => {
    expect(rules.winner_points).toEqual(BRIEF.winner_points);
    expect(rules.sets_points).toEqual(BRIEF.sets_points);
    expect(rules.per_set_exact).toBe(BRIEF.per_set_exact);
    expect(rules.upset_constant).toBe(BRIEF.upset_constant);
    expect(rules.deciding_set).toBe("full");
    expect(rules.allowed_set_scores).toEqual([
      [6, 0],
      [6, 1],
      [6, 2],
      [6, 3],
      [6, 4],
      [7, 5],
      [7, 6],
    ]);
  });

  test("the How to play table renders straight from rules (no number typed into the page)", () => {
    const page = src("src", "routes", "how-to-play.tsx");
    expect(page).toContain("rules.winner_points[r]");
    expect(page).toContain("rules.sets_points[r]");
    expect(page).toContain("`+${e}`");
    // no literal point value inside the JSX table/example (8, 13, 20, 4, 6, 10, 30 as bare numbers)
    expect(page).not.toMatch(/[>{]\s*(8|13|20|30)\s*[<}]/);
  });

  test("SQL win_points = 'winner points × (1 + gap ÷ (gap + 30)), halves round up' for every gap 0–500", async () => {
    const rows = (
      await db.query<{ r: Round; gap: number; pts: number }>(
        `select r, g as gap, public.win_points(r, 1 + g, 1) as pts
           from unnest(array['QF','SF','3P','F']) r, generate_series(0, 500) g`,
      )
    ).rows;
    const bad = rows.filter((x) => x.pts !== upset(BRIEF.winner_points[x.r], x.gap, 30));
    expect(bad).toEqual([]);
    // there really are .5 cases in range, and they went up: QF gap 2 = 8.5 → 9
    expect(rows.find((x) => x.r === "QF" && x.gap === 2)?.pts).toBe(9);
  });
});

describe("Q1 htp_max (How to play: 'The most you can score without upsets, if every match ends in 2 sets')", () => {
  const independentMax = () =>
    // the bracket: 2 QF, 2 SF, one 3rd place, one final; each: winner + sets + 2 exact sets
    (["QF", "QF", "SF", "SF", "3P", "F"] as Round[]).reduce(
      (s, r) => s + BRIEF.winner_points[r] + BRIEF.sets_points[r] + 2 * BRIEF.per_set_exact,
      0,
    );

  test("recomputed from config = 128", () => {
    expect(independentMax()).toBe(128);
  });

  test("the page's formula uses the same bracket shape as the real draw (2 QF, 2 SF, 3P, F)", async () => {
    const page = src("src", "routes", "how-to-play.tsx");
    expect(page).toContain(
      'const max = 2 * perfect("QF") + 2 * perfect("SF") + perfect("3P") + perfect("F");',
    );
    expect(page).toContain("rules.winner_points[r] + rules.sets_points[r] + 2 * e");
    const db2 = await freshDb();
    try {
      await loadRealDraw(db2);
      const shape = (
        await db2.query<{ round: string; n: number }>(
          "select round, count(*)::int as n from public.matches group by round order by round",
        )
      ).rows;
      expect(Object.fromEntries(shape.map((x) => [x.round, x.n]))).toEqual({
        "3P": 1,
        F: 1,
        QF: 2,
        SF: 2,
      });
    } finally {
      await db2.close();
    }
  });

  test("EN and AR copy carry {max} and both qualifiers (no upsets; every match in 2 sets)", () => {
    expect(en.htp_max).toContain("{max}");
    expect(ar.htp_max).toContain("{max}");
    expect(en.htp_max).toMatch(/without upsets/);
    expect(en.htp_max).toMatch(/2 sets/);
    expect(ar.htp_max).toContain("دون مفاجآت"); // without upsets
    expect(ar.htp_max).toContain("مجموعتين"); // two sets
  });

  // End to end: one fan calls all six matches perfectly, favourites win in 2 sets → standings say 128.
  test("the scoring SQL pays exactly htp_max for six perfect 2-set calls without upsets", async () => {
    const d = await freshDb();
    try {
      await d.exec("select t.setup_event()"); // invented players, ranks 1,2,3,5,7,10
      await d.query("select t.new_user(1)");
      const pick = async (m: number, w: string) =>
        expect(
          await one(d, "select t.pick($1::uuid, $2, $3, $4)", [uid(1), m, w, "6-4 6-4"]),
        ).toBeNull();
      await pick(1, "c"); // QF1 c(3) v f(10)
      await pick(2, "d"); // QF2 d(5) v e(7)
      await d.exec("select public.dev_set_now('2026-10-21 20:00+00')");
      await d.exec(
        "select t.feed(1, 'completed', 'c', '6-4 6-4'); select t.feed(2, 'completed', 'd', '6-4 6-4')",
      );
      await pick(3, "a"); // SF1 a(1) v c(3)
      await pick(4, "b"); // SF2 b(2) v d(5)
      await d.exec("select public.dev_set_now('2026-10-22 20:30+00')");
      await d.exec(
        "select t.feed(3, 'completed', 'a', '6-4 6-4'); select t.feed(4, 'completed', 'b', '6-4 6-4')",
      );
      await pick(5, "c"); // 3P c(3) v d(5)
      await pick(6, "a"); // F a(1) v b(2)
      await d.exec("select public.dev_set_now('2026-10-24 21:00+00')");
      await d.exec(
        "select t.feed(5, 'completed', 'c', '6-4 6-4'); select t.feed(6, 'completed', 'a', '6-4 6-4')",
      );
      expect(await one(d, "select points from public.standings where user_id = $1", [uid(1)])).toBe(
        independentMax(),
      );
    } finally {
      await d.close();
    }
  }, 60_000);

  // The landing example (QF: pick 6-4 6-3, result 6-4 7-5) and the How to play example (SF: pick
  // 6-4 3-6 6-3, result 6-4 4-6 6-3), run through the real scoring SQL with favourites winning.
  test("the two worked examples score as printed (landing 8+4+2 = 14, How to play 13+6+4 = 23)", async () => {
    const d = await freshDb();
    try {
      await d.exec("select t.setup_event()");
      for (const n of [2, 3]) await d.query("select t.new_user($1)", [n]);
      const pick = async (u: number, m: number, w: string, s: string) =>
        expect(await one(d, "select t.pick($1::uuid, $2, $3, $4)", [uid(u), m, w, s])).toBeNull();
      await pick(2, 1, "c", "6-4 6-3");
      await d.exec("select public.dev_set_now('2026-10-21 20:00+00')");
      await d.exec("select t.feed(1, 'completed', 'c', '6-4 7-5')");
      await pick(3, 3, "a", "6-4 3-6 6-3");
      await d.exec("select public.dev_set_now('2026-10-22 20:30+00')");
      await d.exec("select t.feed(3, 'completed', 'a', '6-4 4-6 6-3')");
      expect(await one(d, "select t.pts($1::uuid, 1)", [uid(2)])).toBe(
        `${BRIEF.winner_points.QF}/${BRIEF.sets_points.QF}/${BRIEF.per_set_exact}/14`,
      );
      expect(await one(d, "select t.pts($1::uuid, 3)", [uid(3)])).toBe(
        `${BRIEF.winner_points.SF}/${BRIEF.sets_points.SF}/${2 * BRIEF.per_set_exact}/23`,
      );
    } finally {
      await d.close();
    }
  }, 60_000);
});

describe("Q1 worked examples in the copy agree with themselves", () => {
  test("landing example: pick 6-4 6-3, result 6-4 7-5, miss line says set 2 was 6-3 vs 7-5 (EN + AR)", () => {
    const landing = src("src", "routes", "index.tsx");
    expect(landing).toContain("{name} 6-4 6-3");
    expect(landing).toContain("{name} 6-4 7-5");
    expect(en.example_miss).toContain("6-3");
    expect(en.example_miss).toContain("7-5");
    expect(ar.example_miss).toContain("6-3");
    expect(ar.example_miss).toContain("7-5");
    expect(landing).toContain('t("example_sets", { n: 2 })');
    expect(landing).toContain('t("example_exact", { n: 1 })');
  });

  test("How to play example: pick 6-4 3-6 6-3, result 6-4 4-6 6-3, sets 1 and 3 exact (EN + AR)", () => {
    for (const s of [en, ar]) {
      expect(s.htp_example_pick.replace(/،/g, ",")).toMatch(/6-4, 3-6, 6-3/);
      expect(s.htp_example_result.replace(/،/g, ",")).toMatch(/6-4, 4-6, 6-3/);
      expect(s.htp_example_miss).toContain("3-6");
      expect(s.htp_example_miss).toContain("4-6");
      expect(s.htp_example_sets).toContain("(3)");
    }
    expect(en.htp_example_exact).toBe("Sets 1 and 3 exactly right");
    expect(ar.htp_example_exact).toContain("1 و3");
  });

  test("generic upset example (no. 10 beats no. 1 in a QF) = the SQL's points", async () => {
    const page = src("src", "routes", "how-to-play.tsx");
    expect(page).toContain("const gap = 9;");
    const shown = Math.floor(8 * (1 + 9 / (9 + 30)) + 0.5); // the page's own expression
    expect(shown).toBe(upset(8, 9, 30));
    expect(await one(db, "select public.win_points('QF', 10, 1)")).toBe(shown);
    expect(fill(en.htp_upset_example, { low: 10, high: 1, points: shown, base: 8 })).toBe(
      "Example: world no. 10 beats world no. 1 in a quarter-final: 10 points for the winner instead of 8.",
    );
  });

  test("real draw: stored p1/p2_win_points = the formula on the stored ranks", async () => {
    const d = await freshDb();
    try {
      await loadRealDraw(d);
      const rows = (
        await d.query<{ round: Round; r1: number; r2: number; w1: number; w2: number }>(
          `select m.round, a.rank_snapshot r1, b.rank_snapshot r2, m.p1_win_points w1, m.p2_win_points w2
             from public.matches m join public.players a on a.id = m.p1_id join public.players b on b.id = m.p2_id`,
        )
      ).rows;
      expect(rows.length).toBe(2); // the two QFs; SF/3P/F fill as results arrive
      for (const r of rows) {
        expect(r.w1).toBe(upset(BRIEF.winner_points[r.round], r.r1 - r.r2, 30));
        expect(r.w2).toBe(upset(BRIEF.winner_points[r.round], r.r2 - r.r1, 30));
      }
    } finally {
      await d.close();
    }
  });

  // The landing example names the first quarter-final's player 1 (src/routes/index.tsx:33-34) and
  // prints "+8 Right winner" and a 14-point total. With the real draw that is Taylor Fritz (rank 10)
  // against Zverev (rank 2): a correct Fritz pick is worth 10 winner points, so the example, told
  // with a real name, understates the real points (label only says "more for an upset").
  test("SMELL landing example names a real player for whom '+8 Right winner' is wrong (Fritz = 10)", async () => {
    const d = await freshDb();
    try {
      await loadRealDraw(d);
      const named = (
        await d.query<{ p1_id: string; p1_win_points: number }>(
          "select p1_id, p1_win_points from public.matches where round = 'QF' and p1_id is not null order by match_no limit 1",
        )
      ).rows[0]!;
      expect(named.p1_id).toBe("fritz");
      expect(named.p1_win_points).toBe(BRIEF.winner_points.QF); // FAILS today: 10
    } finally {
      await d.close();
    }
  });
});

describe("Q1 every other number in the copy (EN and AR)", () => {
  const toml = src("supabase", "config.toml");
  const tomlNum = (key: string) =>
    Number(new RegExp(`^${key}\\s*=\\s*(\\d+)`, "m").exec(toml)?.[1]);

  test("display name 2 to 24 characters = clean_display_name", async () => {
    for (const s of [en.display_name_hint, en.err_display_name_length])
      expect(s).toMatch(/2 to 24/);
    for (const s of [ar.display_name_hint, ar.err_display_name_length])
      expect(s).toMatch(/2 إلى 24/);
    const ok = async (n: number) =>
      (await one(db, "select public.clean_display_name($1) is not null", [
        "x".repeat(n),
      ])) as boolean;
    expect([await ok(1), await ok(2), await ok(24), await ok(25)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  test("league name 1 to 40 characters = create_league and the table check", async () => {
    expect(en.err_league_name_length).toMatch(/1 to 40/);
    expect(ar.err_league_name_length).toMatch(/1 إلى 40/);
    const latest = src("supabase", "migrations", "0015_league_and_rank_fixes.sql");
    expect(latest).toContain("char_length(v_name) not between 1 and 40");
    expect(src("supabase", "migrations", "0002_tables.sql")).toContain(
      "check (char_length(name) between 1 and 40)",
    );
  });

  test("league code: '6-character code' = gen_league_code", async () => {
    expect(en.league_code).toMatch(/^6-character/);
    expect(ar.league_code).toContain("6");
    const lens = (
      await db.query<{ l: number }>(
        "select distinct char_length(public.gen_league_code())::int as l from generate_series(1, 200)",
      )
    ).rows.map((r) => r.l);
    expect(lens).toEqual([6]);
  });

  test("sign-in code: '6-digit code' = auth.email.otp_length; password 8 = minimum_password_length", () => {
    expect(tomlNum("otp_length")).toBe(6);
    for (const s of [en.code_sent, en.code_label, ar.code_sent, ar.code_label])
      expect(s).toContain("6");
    expect(tomlNum("minimum_password_length")).toBe(8);
    for (const s of [
      en.password_hint,
      en.password_too_short,
      ar.password_hint,
      ar.password_too_short,
    ])
      expect(s).toContain("8");
  });

  test("wrong league codes: 'Try again in 10 minutes' = join_league's 10-minute window", () => {
    const sql = src("supabase", "migrations", "0015_league_and_rank_fixes.sql");
    expect(sql).toContain("interval '10 minutes'");
    expect(en.err_too_many_attempts).toContain("10 minutes");
    expect(ar.err_too_many_attempts).toContain("10 دقائق");
  });

  test("match count, players, nights: copy = the real draw (6 matches, 6 players, Riyadh 21, 22 & 24 Oct)", async () => {
    const d = await freshDb();
    try {
      await loadRealDraw(d);
      expect(await one(d, "select count(*)::int from public.matches")).toBe(6);
      expect(await one(d, "select count(*)::int from public.players")).toBe(6);
      const days = (
        await d.query<{ day: string }>(
          "select distinct to_char(starts_at at time zone 'Asia/Riyadh', 'DD') as day from public.matches order by 1",
        )
      ).rows.map((r) => r.day);
      expect(days).toEqual(["21", "22", "24"]);
      const branding = await one<Record<string, string>>(
        d,
        "select branding from public.event_config",
      );
      expect(branding["event_line"]).toBe("Six players · Riyadh · 21, 22 & 24 October");
      expect(branding["event_line_ar"]).toContain("21 و22 و24 أكتوبر");
      expect(branding["event_line_ar"]).toContain("ستة لاعبين");
      // the How to play subtitle hard-codes n: 6 (how-to-play.tsx:76); it must equal the bracket
      expect(src("src", "routes", "how-to-play.tsx")).toContain('t("landing_sentence", { n: 6 })');
    } finally {
      await d.close();
    }
  });

  test("Arabic keeps Western digits (no ٠-٩ / ۰-۹) and the same numbers as English, key by key", () => {
    const digits = (s: string) => (s.replace(/\{\w+\}/g, "").match(/\d+/g) ?? []).sort().join(",");
    // Keys where the Arabic says the number in words (checked by hand, 5 Oct 2026):
    const inWords: Partial<Record<StringKey, string>> = {
      landing_sentence: "الثلاثة الأولى = top 3",
      landing_prizes: "الثلاثة الأولى = top 3",
      friends_no_prizes: "الثلاثة الأولى = top 3",
      short_3P: "المركز الثالث = 3rd place",
      crowd_pick_one: "توقع واحد = 1 pick",
      member_one: "عضو واحد = 1 member",
      htp_scoring_intro: "صفراً = 0",
      htp_two_on_three: "مجموعتين … ثلاث = 2 sets … 3",
      htp_max: "مجموعتين = 2 sets",
      err_sets_must_be_2_or_3: "مجموعتين أو ثلاثاً = 2 or 3",
    };
    const bad: string[] = [];
    for (const k of Object.keys(en) as StringKey[]) {
      if (/[٠-٩۰-۹]/.test(ar[k])) bad.push(`${k}: Arabic-Indic digit`);
      if (!(k in inWords) && digits(en[k]) !== digits(ar[k]))
        bad.push(`${k}: EN ${digits(en[k])} AR ${digits(ar[k])}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("Q1 copy that promises what config no longer has (organiser deal ended)", () => {
  // Rule from the brief (H4): the only allowed betting/prize-word hit is the "no betting" fine print.
  test("BUG no prize or betting words in the fan-facing copy (EN + AR)", () => {
    const enRe = /prize|wager|odds|stake|gambl|\bbet\b|win more/i;
    const arRe = /جائز|جوائز|راهن|رهان|مراهن|اربح/;
    const hits = (Object.keys(en) as StringKey[]).flatMap((k) => [
      ...(enRe.test(en[k]) ? [`en.${k}: "${en[k].match(enRe)![0]}"`] : []),
      ...(arRe.test(ar[k]) ? [`ar.${k}: "${ar[k].match(arRe)![0]}"`] : []),
    ]);
    // FAILS today: landing_sentence, landing_prizes, prize_terms, friends_no_prizes (EN+AR) and
    // htp_upset ("win more" / "راهن … واربح": "bet on … and win")
    expect(hits).toEqual([]);
  });

  test("BUG event_config.prizes holds no organiser placeholder (PrizeStrip renders whenever prizes is non-empty)", async () => {
    const prizes = await one<{ title: string }[]>(db, "select prizes from public.event_config");
    expect(src("src", "components", "Brand.tsx")).toContain(
      "if (event.prizes.length === 0) return null;",
    );
    // FAILS today: three "First/Second/Third prize (text to come from the organiser)" rows, shown on
    // the landing page, How to play, Standings (signed out) and the podium.
    expect(prizes.filter((p) => /organiser|to come/i.test(p.title))).toEqual([]);
  });
});
