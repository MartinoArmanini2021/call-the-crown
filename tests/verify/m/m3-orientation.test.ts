// M3 — orientation (orient_set_scores and the p1/p2 flip), plus M1-C: provider-result fuzz.
//   1. orient_set_scores on 5,000 random well-formed arrays: flip = swap the two columns, nothing else.
//   2. 2,000 provider payloads drawn from a pool of 80 random results (completed, retired, walkover, and
//      fuzzed invalid ones), each sent in a random orientation, through ingest_result:
//      · accepted/rejected/unchanged exactly as the oracle says (result validity per the rules);
//      · the stored result is the result in OUR player order whatever the provider's order;
//      · the same real result, entered from either player's side, gives byte-identical pick scores;
//      · every pick's score equals the oracle's.
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { loadEventRules, resultValidity, scorePick, type Result, type Set } from "../oracle";
import {
  boot,
  fromJson,
  ingest,
  matches,
  payload,
  prng,
  q,
  savePicks,
  SEED,
  setNow,
  uid,
} from "./harness";
import { legalMatch, rawResult } from "./gen";

const rules = loadEventRules();
const dbs: PGlite[] = [];
afterAll(async () => {
  for (const d of dbs) await d.close();
});

describe("M3 orientation", () => {
  it("orient_set_scores: flip swaps the columns of every set and keeps the order (5,000 random arrays)", async () => {
    const db = await boot();
    dbs.push(db);
    const rng = prng(SEED + 30);
    const cases = Array.from({ length: 5000 }, (_, i) => {
      const n = rng.int(0, 4);
      const sets = Array.from({ length: n }, () => [rng.int(0, 99), rng.int(0, 99)] as Set);
      return {
        i,
        flip: rng.chance(0.5),
        sc: sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
        sets,
      };
    });
    const rows = await q<{ i: number; o: { p1_games: number; p2_games: number }[] | null }>(
      db,
      `select x.i, public.orient_set_scores(x.sc, x.flip) as o
           from jsonb_to_recordset($1::jsonb) as x(i int, flip boolean, sc jsonb) order by x.i`,
      [JSON.stringify(cases.map(({ i, flip, sc }) => ({ i, flip, sc })))],
    );
    let bad = 0;
    for (const c of cases) {
      const want = c.flip ? c.sets.map(([a, b]) => [b, a]) : c.sets;
      if (JSON.stringify(fromJson(rows[c.i]!.o)) !== JSON.stringify(want)) bad++;
    }
    // malformed input is refused (null), not guessed
    const malformed = await q<{ o: unknown }>(
      db,
      `select public.orient_set_scores(x, true) as o from unnest(array[
           '[{"p1_games": "6", "p2_games": 4}]', '[{"p1_games": 6.5, "p2_games": 4}]',
           '[{"p1_games": -1, "p2_games": 4}]', '[{"p1_games": 100, "p2_games": 4}]',
           '[{"p1_games": 6}]', '[[6, 4]]', '{"p1_games": 6, "p2_games": 4}']::jsonb[]) x`,
    );
    console.log(
      JSON.stringify({
        section: "M3.1",
        cases: cases.length,
        mismatches: bad,
        malformed: malformed.map((m) => m.o),
      }),
    );
    expect(bad).toBe(0);
    expect(malformed.every((m) => m.o === null)).toBe(true);
  }, 120_000);

  it("M1-C + M3: 2,000 provider payloads, either orientation: outcomes, stored result and scores match the oracle; both sides score identically", async () => {
    const db = await boot();
    dbs.push(db);
    const rng = prng(SEED + 31);
    await db.query("select t.setup_event()");
    const USERS = 60;
    await db.query(`select t.new_user(n) from generate_series(1, ${USERS}) n`);
    const ranks: Record<string, number> = { a: 1, b: 2, c: 3, d: 5, e: 7, f: 10 };
    // valid random picks on both quarter-finals (QF1 c v f: upset bonus 10; QF2 d v e: 8.5 → 9)
    const picks = new Map<string, { winner: 1 | 2; sets: Set[] }>();
    const rows: Parameters<typeof savePicks>[1] = [];
    const ms = await matches(db);
    for (let u = 1; u <= USERS; u++)
      for (const m of [1, 2]) {
        const w = rng.pick([1, 2] as const);
        const sets = legalMatch(rules, rng, w, rng.chance(0.5) ? 2 : 3);
        const mm = ms.find((x) => x.match_no === m)!;
        picks.set(`${uid(u)}:${m}`, { winner: w, sets });
        rows.push({
          uid: uid(u),
          match: m,
          winner: w === 1 ? mm.p1_id : mm.p2_id,
          sets: sets.length,
          scores: sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
        });
      }
    const saved = await savePicks(db, rows);
    expect(saved.errors.every((e) => e === null)).toBe(true);
    await setNow(db, "2026-10-21 20:00+00");

    const pool: Result[] = Array.from({ length: 80 }, () => rawResult(rules, rng));
    const current = new Map<number, Result>();
    const snapshots = new Map<string, { snap: string; flip: boolean }>(); // `${match}|${canonical result}` → scores of every pick
    const stats = {
      payloads: 0,
      outcomes: {} as Record<string, number>,
      outcomeMismatch: 0,
      storedMismatch: 0,
      scoreMismatch: 0,
      crossSideComparisons: 0,
      crossSideMismatch: 0,
      examples: [] as unknown[],
    };
    for (let k = 0; k < 2000; k++) {
      const m = rng.pick([1, 2]);
      const r = rng.pick(pool);
      const flip = rng.chance(0.5);
      const mm = ms.find((x) => x.match_no === m)!;
      const out = await ingest(
        db,
        payload(m, mm.p1_id!, mm.p2_id!, r.status, r.winner, r.sets, flip),
      );
      stats.payloads++;
      stats.outcomes[out.outcome] = (stats.outcomes[out.outcome] ?? 0) + 1;
      const v = resultValidity(rules, r.status, r.winner, r.sets);
      const cur = current.get(m);
      const same = !!cur && JSON.stringify(cur) === JSON.stringify(r);
      const expected = !v.ok
        ? "rejected_invalid"
        : same
          ? "unchanged"
          : cur
            ? "resettled"
            : "settled";
      if (out.outcome !== expected) {
        stats.outcomeMismatch++;
        if (stats.examples.length < 10) stats.examples.push({ r, flip, out, v, expected });
        continue;
      }
      if (!v.ok) continue;
      current.set(m, r);
      const stored = (await matches(db)).find((x) => x.match_no === m)!;
      if (
        stored.status !== r.status ||
        stored.winner_id !== (r.winner === 1 ? mm.p1_id : mm.p2_id) ||
        JSON.stringify(fromJson(stored.set_scores)) !== JSON.stringify(r.sets)
      ) {
        stats.storedMismatch++;
        if (stats.examples.length < 10) stats.examples.push({ kind: "stored", r, flip, stored });
      }
      const pr = await q<{ user_id: string; s: string }>(
        db,
        `select user_id, concat_ws('/', pts_winner, pts_sets, pts_exact, exact_sets, pts_total, exact_flags::text) as s
             from public.picks where match_no = $1 order by user_id`,
        [m],
      );
      for (const p of pr) {
        const o = picks.get(`${p.user_id}:${m}`)!;
        const s = scorePick(rules, mm.round, [ranks[mm.p1_id!]!, ranks[mm.p2_id!]!], r, o);
        const flags =
          s.flags === null
            ? null
            : `{${s.flags.map((x) => (x === null ? "NULL" : x ? "t" : "f")).join(",")}}`;
        const want = [s.winner, s.sets, s.exact, s.exactSets, s.total, flags]
          .filter((x) => x !== null)
          .join("/");
        if (p.s !== want) {
          stats.scoreMismatch++;
          if (stats.examples.length < 10)
            stats.examples.push({ kind: "score", r, o, db: p.s, want });
        }
      }
      const key = `${m}|${JSON.stringify(r)}`;
      const snap = JSON.stringify(pr);
      const prev = snapshots.get(key);
      if (prev !== undefined && prev.flip !== flip) {
        stats.crossSideComparisons++;
        if (prev.snap !== snap) stats.crossSideMismatch++;
      } else if (prev === undefined) snapshots.set(key, { snap, flip });
    }
    console.log(JSON.stringify({ section: "M1-C/M3.2", seed: SEED + 31, ...stats }, null, 1));
    expect(stats.outcomeMismatch).toBe(0);
    expect(stats.storedMismatch).toBe(0);
    expect(stats.scoreMismatch).toBe(0);
    expect(stats.crossSideMismatch).toBe(0);
    expect(stats.crossSideComparisons).toBeGreaterThan(100);
  }, 900_000);
});
