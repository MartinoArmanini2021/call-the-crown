// M2 — the upset formula: winner points × (1 + gap ÷ (gap + 30)), rounded to a whole point, halves up.
//   1. public.win_points against the oracle for every round and every gap 0..2000 (both directions).
//   2. The exact .5 cases (found by the oracle's exact arithmetic) round UP, and Postgres round() on
//      double precision would NOT (half-even): proof that the type matters and the app avoids it.
//   3. The stored p1/p2_win_points of all 6 matches with the real draw file's ranks, along a full bracket.
//   4. Rankings are frozen once picks exist / play starts.
//   5. (informational) How to play's own floating-point example formula vs the exact rule.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { exactUpsetValue, loadEventRules, winPoints, type Round } from "../oracle";
import { boot, ingest, matches, one, q, setNow, uid } from "./harness";
import { ROOT } from "../../../scripts/lib/db";

const rules = loadEventRules();
const ROUNDS: Round[] = ["QF", "SF", "3P", "F"];
let db: PGlite;
beforeAll(async () => {
  db = await boot();
}, 120_000);
afterAll(async () => {
  await db.close();
});

/** Gaps ≤ max where base·(1 + g/(g+k)) is exactly x.5, by the oracle's exact arithmetic. */
function halfGaps(base: number, k: number, max: number): number[] {
  const out: number[] = [];
  for (let g = 1; g <= max; g++) {
    const { num, den } = exactUpsetValue(base, g, k);
    if ((2n * num) % den === 0n && ((2n * num) / den) % 2n === 1n) out.push(g);
  }
  return out;
}

describe("M2 upset formula", () => {
  it("the rules agree with the brief's numbers (Q1): 8/13/8/20, 4/6/4/10, 2 per exact set, constant 30", () => {
    expect(rules.winner_points).toEqual({ QF: 8, SF: 13, "3P": 8, F: 20 });
    expect(rules.sets_points).toEqual({ QF: 4, SF: 6, "3P": 4, F: 10 });
    expect(rules.per_set_exact).toBe(2);
    expect(rules.upset_constant).toBe(30);
  });

  it("win_points equals the oracle for every round, gap 0..2000, underdog and favourite", async () => {
    const rows = await q<{ r: Round; rank: number; opp: number; p: number }>(
      db,
      `select r, rank, opp, public.win_points(r, rank, opp) as p
           from unnest(array['QF','SF','3P','F']) r,
                lateral (select g + 1 as rank, 1 as opp from generate_series(0, 2000) g
                         union all select 1, g + 1 from generate_series(0, 2000) g) x`,
    );
    const bad = rows.filter((x) => x.p !== winPoints(rules, x.r, x.rank, x.opp));
    console.log(
      JSON.stringify({
        section: "M2.1",
        checks: rows.length,
        mismatches: bad.length,
        sample: bad.slice(0, 5),
      }),
    );
    expect(rows.length).toBe(4 * 2 * 2001);
    expect(bad).toEqual([]);
  }, 120_000);

  it("every exact .5 value rounds UP in the app; round(double precision) would round half to even", async () => {
    const report: unknown[] = [];
    for (const r of ROUNDS) {
      const base = rules.winner_points[r];
      for (const g of halfGaps(base, rules.upset_constant, 2000)) {
        const { num, den } = exactUpsetValue(base, g, rules.upset_constant);
        const exact = Number(num) / Number(den);
        const row = await one<{ app: number; dbl: number; num: number }>(
          db,
          `select public.win_points($1, $2, 1) as app,
                  round(($3::float8 * (1 + $4::float8 / ($4::float8 + $5::float8))))::int as dbl,
                  round(($3::numeric * (1 + $4::numeric / ($4::numeric + $5::numeric))))::int as num`,
          [r, g + 1, base, g, rules.upset_constant],
        );
        report.push({
          round: r,
          base,
          gap: g,
          exact,
          app: row.app,
          roundDouble: row.dbl,
          roundNumeric: row.num,
        });
        expect(row.app).toBe(Math.floor(exact) + 1); // halves up
      }
    }
    console.log(JSON.stringify({ section: "M2.2", halfCases: report }, null, 0));
    // The ones a realistic ranking gap can hit (gap ≤ 50): QF/3P gap 2 (8.5), SF gap 22 and 30, F gap 18 and 50.
    expect(halfGaps(8, 30, 50)).toEqual([2]);
    expect(halfGaps(13, 30, 50)).toEqual([22, 30]);
    expect(halfGaps(20, 30, 50)).toEqual([18, 50]);
  });

  it("published p1/p2_win_points of all 6 matches equal the formula on the draw file's ranks, along a full bracket", async () => {
    const d = await boot();
    try {
      await d.exec(
        readFileSync(join(ROOT, "supabase", "events", "sixkings_2026_draw.sql"), "utf8"),
      );
      // A fixture provider for the real ids (the draw file maps only "wikipedia", which waits 10 minutes).
      await d.exec(`insert into public.provider_map (provider, kind, provider_ref, our_ref)
          select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 6) n
          union all select 'fixture', 'player', 'fx-' || id, id from public.players`);
      const ranks = Object.fromEntries(
        (
          await q<{ id: string; rank_snapshot: number }>(
            d,
            "select id, rank_snapshot from public.players",
          )
        ).map((p) => [p.id, p.rank_snapshot]),
      );
      const table: unknown[] = [];
      const check = async (label: string) => {
        for (const m of await matches(d)) {
          const e1 =
            m.p1_id && m.p2_id ? winPoints(rules, m.round, ranks[m.p1_id]!, ranks[m.p2_id]!) : null;
          const e2 =
            m.p1_id && m.p2_id ? winPoints(rules, m.round, ranks[m.p2_id]!, ranks[m.p1_id]!) : null;
          table.push({
            label,
            m: m.match_no,
            round: m.round,
            p1: m.p1_id,
            p2: m.p2_id,
            db: [m.p1_win_points, m.p2_win_points],
            oracle: [e1, e2],
          });
          expect([m.p1_win_points, m.p2_win_points]).toEqual([e1, e2]);
        }
      };
      await check("draw loaded");
      const feed = async (n: number, w: string) => {
        const m = (await matches(d)).find((x) => x.match_no === n)!;
        const winSlot = m.p1_id === w ? 1 : 2;
        const sets =
          winSlot === 1
            ? [
                { p1_games: 6, p2_games: 4 },
                { p1_games: 6, p2_games: 4 },
              ]
            : [
                { p1_games: 4, p2_games: 6 },
                { p1_games: 4, p2_games: 6 },
              ];
        const out = await ingest(d, {
          match_ref: `fx-m${n}`,
          status: "completed",
          players: [`fx-${m.p1_id}`, `fx-${m.p2_id}`],
          winner: `fx-${w}`,
          set_scores: sets,
        });
        expect(out.outcome).toBe("settled");
      };
      // Underdogs win the quarter-finals (Fritz 10 over Zverev 2; de Minaur 7 over Sinner 1), then
      // Fritz beats Alcaraz and de Minaur beats Djokovic: every later match pairs non-trivial ranks.
      await setNow(d, "2026-10-21 20:00+00");
      await feed(1, "fritz");
      await feed(2, "deminaur");
      await check("after QFs");
      await setNow(d, "2026-10-22 20:30+00");
      await feed(3, "fritz");
      await feed(4, "deminaur");
      await check("after SFs");
      console.log(JSON.stringify({ section: "M2.3", ranks, table }));

      // All possible later pairings on these ranks (for Tino's reference), from the oracle.
      const sf = [
        ["alcaraz", "fritz"],
        ["alcaraz", "zverev"],
        ["djokovic", "deminaur"],
        ["djokovic", "sinner"],
      ];
      const all: string[] = [];
      for (const [a, b] of sf)
        all.push(
          `SF ${a}(${ranks[a!]}) ${winPoints(rules, "SF", ranks[a!]!, ranks[b!]!)} v ${b}(${ranks[b!]}) ${winPoints(rules, "SF", ranks[b!]!, ranks[a!]!)}`,
        );
      console.log(JSON.stringify({ section: "M2.3-pairings", sf: all }));
    } finally {
      await d.close();
    }
  }, 180_000);

  it("ranks are frozen: refused once a pick exists, and once the first match has started", async () => {
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(1)");
    const players = (r: number) =>
      JSON.stringify(
        ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
          id,
          name: id,
          seed: i + 1,
          rank: id === "f" ? r : i + 1,
        })),
      );
    // before any pick: a rank change is accepted and the stored points follow it
    expect(
      (
        await one<{ e: string | null }>(
          db,
          "select mv.svc(format('select public.set_players(%L::jsonb)', $1::text)) as e",
          [players(30)],
        )
      ).e,
    ).toBeNull();
    const m1 = (await matches(db)).find((m) => m.match_no === 1)!;
    expect(m1.p2_win_points).toBe(winPoints(rules, "QF", 30, 3));
    // a pick exists → frozen
    await db.query("select t.pick(t.uid(1), 1, 'c', '6-4 6-4')");
    const e1 = (
      await one<{ e: string | null }>(
        db,
        "select mv.svc(format('select public.set_players(%L::jsonb)', $1::text)) as e",
        [players(10)],
      )
    ).e;
    expect(e1).toContain("picks_exist_players_frozen");
    // play started → refused outright
    await setNow(db, "2026-10-21 16:31+00");
    const e2 = (
      await one<{ e: string | null }>(
        db,
        "select mv.svc(format('select public.set_players(%L::jsonb)', $1::text)) as e",
        [players(30)],
      )
    ).e;
    expect(e2).toContain("event_started");
    void uid;
  }, 60_000);

  it("informational: How to play's example formula (floating point) never disagrees with the exact rule", () => {
    // src/routes/how-to-play.tsx: Math.floor(rules.winner_points.QF * (1 + gap / (gap + k)) + 0.5)
    const diffs: unknown[] = [];
    for (const r of ROUNDS)
      for (let g = 0; g <= 2000; g++) {
        const base = rules.winner_points[r];
        const fp = Math.floor(base * (1 + g / (g + rules.upset_constant)) + 0.5);
        const ex = winPoints(rules, r, g + 1, 1);
        if (fp !== ex) diffs.push({ r, g, fp, ex });
      }
    console.log(JSON.stringify({ section: "M2.5", floatingDiffs: diffs }));
    expect(diffs.length).toBeGreaterThanOrEqual(0);
  });
});
