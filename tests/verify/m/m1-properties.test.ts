// M1 — property tests: the app (SQL in PGlite, and the client validator) against the independent oracle.
//   A. 10,000 random set-score inputs: public.validate_set_scores vs src/lib/validation.ts (exact error
//      codes must agree) vs oracle.pickValidity (legal / illegal must agree).
//   B. Full random events through the real RPCs (save_pick, ingest_result → settle_match): every pick
//      attempt's acceptance, every result's acceptance, every scored pick's five numbers + exact_flags,
//      the stored potential winner points, the bracket and the whole standings table, after every
//      settlement and re-settlement, against the oracle.
// Seed: M_SEED env (default 20261005). Printed with the stats.
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { validateSetScores, type ScoreRules } from "../../../src/lib/validation";
import {
  fillBracket,
  gamesIn,
  compareFans,
  loadEventRules,
  pickValidity,
  rankFans,
  resultValidity,
  scorePick,
  winPoints,
  type Fan,
  type Level,
  type Result,
  type Set,
  type Slot,
} from "../oracle";
import {
  boot,
  fromJson,
  ingest,
  matches,
  one,
  payload,
  prng,
  q,
  savePicks,
  seedOf,
  SEED,
  setNow,
  setRanks,
  standings,
  uid,
  type PickRow,
} from "./harness";
import { rawPick, rawResult, toPairs } from "./gen";

const rules = loadEventRules();
const dbs: PGlite[] = [];
afterAll(async () => {
  for (const d of dbs) await d.close();
});

// Postgres timestamptz text → microseconds since the epoch (keeps the sub-millisecond part).
export function micros(ts: string): number {
  const m = ts.match(/^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d(?::?\d\d)?)?$/);
  if (!m) throw new Error(`bad timestamp ${ts}`);
  const tz = m[3] ? (m[3].length === 3 ? `${m[3]}:00` : m[3]) : "Z";
  const ms = Date.parse(`${m[1]!.replace(" ", "T")}${tz}`);
  const frac = (m[2] ?? ".0").slice(1).padEnd(6, "0").slice(0, 6);
  return ms * 1000 + Number(frac);
}

describe("M1-A validation: 10,000 random inputs, SQL vs client vs oracle", () => {
  it("SQL and client agree on every error code; both agree with the oracle on legal/illegal", async () => {
    const db = await boot();
    dbs.push(db);
    const rng = prng(SEED);
    const N = 10_000;
    const cases = Array.from({ length: N }, (_, i) => ({ i, ...rawPick(rules, rng) }));
    // Raw JSON edge cases the generator cannot express (number spellings).
    const raw = [
      '[{"p1_games": 6.0, "p2_games": 4}, {"p1_games": 6, "p2_games": 3}]',
      '[{"p1_games": 6e0, "p2_games": 4}, {"p1_games": 6, "p2_games": 3}]',
      '[{"p1_games": 6.0000000000000001, "p2_games": 4}, {"p1_games": 6, "p2_games": 3}]',
      '[{"p1_games": 6, "p2_games": -0}, {"p1_games": 6, "p2_games": 3}]',
      '[{"p1_games": 1e400, "p2_games": 4}, {"p1_games": 6, "p2_games": 3}]',
      '[{"p1_games": 6, "p2_games": 4, "p1_tiebreak": 7}, {"p1_games": 6, "p2_games": 3}]',
    ];
    const res = await q<{ i: number; e: string | null }>(
      db,
      `select x.i, public.validate_set_scores(x.w, x.s, x.sc) as e
           from jsonb_to_recordset($1::jsonb) as x(i int, w int, s int, sc jsonb) order by x.i`,
      [JSON.stringify(cases.map((c) => ({ i: c.i, w: c.winner, s: c.sets, sc: c.scores })))],
    );
    const rawRes = await q<{ i: number; e: string | null }>(
      db,
      `select i, public.validate_set_scores(1, 2, sc::jsonb) as e
           from unnest($1::text[]) with ordinality as u(sc, i) order by i`,
      [raw],
    );

    let sqlVsClient = 0;
    let appVsOracle = 0;
    let legal = 0;
    const codes: Record<string, number> = {};
    const examples: unknown[] = [];
    for (const c of cases) {
      const sqlErr = res[c.i]!.e;
      const cliErr = validateSetScores(rules as ScoreRules, c.winner, c.sets, c.scores as never);
      const ora = pickValidity(rules, c.winner, c.sets, toPairs(c.scores));
      codes[sqlErr ?? "ok"] = (codes[sqlErr ?? "ok"] ?? 0) + 1;
      if (ora.ok) legal++;
      if (sqlErr !== cliErr) {
        sqlVsClient++;
        if (examples.length < 10) examples.push({ kind: "sql!=client", c, sqlErr, cliErr });
      }
      if ((sqlErr === null) !== ora.ok) {
        appVsOracle++;
        if (examples.length < 10) examples.push({ kind: "app!=oracle", c, sqlErr, ora });
      }
    }
    const rawCmp = raw.map((r, i) => {
      const parsed = JSON.parse(r);
      return {
        json: r,
        sql: rawRes[i]!.e,
        client: validateSetScores(rules as ScoreRules, 1, 2, parsed),
        oracle: pickValidity(rules, 1, 2, toPairs(parsed)).ok ? null : "illegal",
      };
    });
    console.log(
      JSON.stringify(
        {
          section: "M1-A",
          seed: SEED,
          cases: N,
          legal,
          sqlVsClient,
          appVsOracle,
          codes,
          examples,
          rawCmp,
        },
        null,
        1,
      ),
    );
    expect(sqlVsClient).toBe(0);
    expect(appVsOracle).toBe(0);
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------------
type Cur = { slot: Slot; sets: Set[]; at: number };
const RANK_POOL = Array.from({ length: 40 }, (_, i) => i + 1);

async function runEvent(seed: number, users: number, feedsPerMatch: number) {
  const rng = prng(seed);
  const db = await boot();
  dbs.push(db);
  await db.query("select t.setup_event()");
  // random distinct ranks for a..f (upset bonus everywhere, gaps 1..39)
  const pool = [...RANK_POOL];
  const ranks: Record<string, number> = {};
  for (const p of ["a", "b", "c", "d", "e", "f"])
    ranks[p] = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
  await setRanks(db, ranks);
  await db.query(`select t.new_user(n) from generate_series(1, ${users}) n`);
  const seedText = await seedOf(db);

  const stats = {
    seed,
    ranks,
    pickAttempts: 0,
    pickAccepted: 0,
    pickAcceptMismatch: 0,
    results: 0,
    resultOutcomes: {} as Record<string, number>,
    resultMismatch: 0,
    scoredPickComparisons: 0,
    scoreMismatch: 0,
    storedPickMismatch: 0,
    winPointsChecks: 0,
    winPointsMismatch: 0,
    bracketMismatch: 0,
    standingsComparisons: 0,
    standingsMismatch: 0,
    decidedAt: {} as Record<Level, number>,
    examples: [] as unknown[],
  };
  const ex = (x: unknown) => stats.examples.length < 15 && stats.examples.push(x);

  const picks = new Map<string, Cur>(); // `${uid}:${match}`
  const results = new Map<number, Result>();
  const winners: Partial<Record<number, string>> = {};
  const bracketNow = () =>
    fillBracket({ sf1: "a", sf2: "b" }, { qf1: ["c", "f"], qf2: ["d", "e"] }, winners);

  async function checkBracket() {
    const b = bracketNow();
    for (const m of await matches(db)) {
      const o = b[m.match_no]!;
      if (m.p1_id !== o.p1 || m.p2_id !== o.p2) {
        stats.bracketMismatch++;
        ex({ kind: "bracket", m: m.match_no, db: [m.p1_id, m.p2_id], oracle: [o.p1, o.p2] });
      }
      if (m.p1_id && m.p2_id) {
        stats.winPointsChecks += 2;
        const w1 = winPoints(rules, m.round, ranks[m.p1_id]!, ranks[m.p2_id]!);
        const w2 = winPoints(rules, m.round, ranks[m.p2_id]!, ranks[m.p1_id]!);
        if (m.p1_win_points !== w1 || m.p2_win_points !== w2) {
          stats.winPointsMismatch++;
          ex({
            kind: "win_points",
            m: m.match_no,
            db: [m.p1_win_points, m.p2_win_points],
            oracle: [w1, w2],
          });
        }
      }
    }
  }

  async function pickRound(ms: number[], at: string) {
    await setNow(db, at);
    const all = await matches(db);
    const rows: Parameters<typeof savePicks>[1] = [];
    const meta: { key: string; slot: Slot | null; sets: number | null; scores: unknown }[] = [];
    for (let u = 1; u <= users; u++) {
      for (const m of ms) {
        if (rng.chance(0.15)) continue;
        const match = all.find((x) => x.match_no === m)!;
        const key = `${uid(u)}:${m}`;
        const cur = picks.get(key);
        let input: ReturnType<typeof rawPick>;
        if (cur && rng.chance(0.15)) {
          input = {
            winner: cur.slot,
            sets: cur.sets.length,
            scores: cur.sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
          };
        } else input = rawPick(rules, rng);
        const winnerId =
          input.winner === 1
            ? match.p1_id
            : input.winner === 2
              ? match.p2_id
              : input.winner === 3
                ? (["a", "b", "c", "d", "e", "f"].find(
                    (p) => p !== match.p1_id && p !== match.p2_id,
                  ) ?? null)
                : input.winner === 0
                  ? "nobody"
                  : null;
        rows.push({
          uid: uid(u),
          match: m,
          winner: winnerId,
          sets: input.sets,
          scores: input.scores,
        });
        meta.push({
          key,
          slot: input.winner === 1 || input.winner === 2 ? input.winner : null,
          sets: input.sets,
          scores: input.scores,
        });
      }
    }
    const { at: dbAt, errors } = await savePicks(db, rows);
    const t = micros(dbAt);
    meta.forEach((mt, i) => {
      stats.pickAttempts++;
      const appOk = errors[i] === null;
      const ora = pickValidity(rules, mt.slot, mt.sets, toPairs(mt.scores));
      if (appOk) stats.pickAccepted++;
      if (appOk !== ora.ok) {
        stats.pickAcceptMismatch++;
        ex({ kind: "pick accept", row: rows[i], app: errors[i], oracle: ora });
      }
      if (ora.ok) {
        const sets = toPairs(mt.scores) as Set[];
        const cur = picks.get(mt.key);
        const same =
          cur && cur.slot === mt.slot && JSON.stringify(cur.sets) === JSON.stringify(sets);
        picks.set(mt.key, { slot: mt.slot!, sets, at: same ? cur.at : t });
      }
    });
  }

  async function checkStandings() {
    const f = results.get(6);
    const finalTotal = f && f.status === "completed" ? gamesIn(f.sets) : null;
    const all = await matches(db);
    const fans: Fan[] = [];
    for (let u = 1; u <= users; u++) {
      let points = 0;
      let exactSets = 0;
      for (const [m, r] of results) {
        const p = picks.get(`${uid(u)}:${m}`);
        if (!p) continue;
        const mm = all.find((x) => x.match_no === m)!;
        const s = scorePick(rules, mm.round, [ranks[mm.p1_id!]!, ranks[mm.p2_id!]!], r, {
          winner: p.slot,
          sets: p.sets,
        });
        points += s.total;
        exactSets += s.exactSets;
      }
      const fp = picks.get(`${uid(u)}:6`);
      fans.push({
        id: uid(u),
        points,
        exactSets,
        finalGames: fp ? gamesIn(fp.sets) : null,
        finalPickAt: fp ? fp.at : null,
      });
    }
    const order = rankFans(fans, finalTotal, seedText);
    for (let i = 1; i < order.length; i++) {
      const lv = compareFans(order[i - 1]!, order[i]!, finalTotal, seedText).level;
      stats.decidedAt[lv] = (stats.decidedAt[lv] ?? 0) + 1;
    }
    const st = await standings(db);
    stats.standingsComparisons++;
    const dbOrder = st.map((s) => s.user_id);
    const byId = new Map(st.map((s) => [s.user_id, s]));
    let bad = dbOrder.length !== order.length;
    order.forEach((o, i) => {
      const s = byId.get(o.id);
      if (!s || s.rank !== i + 1 || s.points !== o.points || s.exact_sets !== o.exactSets) {
        if (!bad) ex({ kind: "standings", pos: i + 1, oracle: o, db: s });
        bad = true;
      }
    });
    if (bad) stats.standingsMismatch++;
  }

  async function feedRound(ms: number[]) {
    for (const m of ms) {
      for (let k = 0; k < feedsPerMatch || !results.has(m); k++) {
        const mm = (await matches(db)).find((x) => x.match_no === m)!;
        const r = rawResult(rules, rng);
        const flip = rng.chance(0.5);
        const out = await ingest(
          db,
          payload(m, mm.p1_id!, mm.p2_id!, r.status, r.winner, r.sets, flip),
        );
        stats.results++;
        stats.resultOutcomes[out.outcome] = (stats.resultOutcomes[out.outcome] ?? 0) + 1;
        const v = resultValidity(rules, r.status, r.winner, r.sets);
        const cur = results.get(m);
        const same =
          cur &&
          cur.status === r.status &&
          cur.winner === r.winner &&
          JSON.stringify(cur.sets) === JSON.stringify(r.sets);
        const expected = !v.ok
          ? "rejected_invalid"
          : same
            ? "unchanged"
            : cur
              ? "resettled"
              : "settled";
        if (out.outcome !== expected) {
          stats.resultMismatch++;
          ex({ kind: "result outcome", m, r, flip, app: out, oracle: v, expected });
          continue;
        }
        if (!v.ok || same) continue;
        results.set(m, r);
        winners[m] = r.winner === 1 ? mm.p1_id! : mm.p2_id!;
        // every pick on this match
        const rows = await q<PickRow & { upd: string; ftxt: string | null }>(
          db,
          "select p.*, p.updated_at::text as upd, p.exact_flags::text as ftxt from public.picks p where match_no = $1",
          [m],
        );
        const dbKeys = new Set(rows.map((p) => `${p.user_id}:${m}`));
        for (const [key] of picks)
          if (key.endsWith(`:${m}`) && !dbKeys.has(key)) {
            stats.storedPickMismatch++;
            ex({ kind: "pick missing in db", key });
          }
        for (const p of rows) {
          const o = picks.get(`${p.user_id}:${m}`);
          if (!o) {
            stats.storedPickMismatch++;
            ex({ kind: "pick in db the oracle rejected", p });
            continue;
          }
          const slot = p.winner_id === mm.p1_id ? 1 : 2;
          if (
            slot !== o.slot ||
            p.sets !== o.sets.length ||
            JSON.stringify(fromJson(p.set_scores)) !== JSON.stringify(o.sets) ||
            micros(p.upd) !== o.at
          ) {
            stats.storedPickMismatch++;
            ex({ kind: "stored pick", db: p, oracle: o });
          }
          const s = scorePick(rules, mm.round, [ranks[mm.p1_id!]!, ranks[mm.p2_id!]!], r, {
            winner: o.slot,
            sets: o.sets,
          });
          stats.scoredPickComparisons++;
          const flags = p.ftxt;
          if (
            p.pts_winner !== s.winner ||
            p.pts_sets !== s.sets ||
            p.pts_exact !== s.exact ||
            p.exact_sets !== s.exactSets ||
            p.pts_total !== s.total ||
            flags !== flagsText(s.flags)
          ) {
            stats.scoreMismatch++;
            ex({ kind: "score", m, result: r, pick: o, db: p, oracle: s });
          }
        }
        await checkBracket();
        await checkStandings();
      }
    }
  }

  await checkBracket();
  await pickRound([1, 2], "2026-10-20 13:00+00");
  await pickRound([1, 2], "2026-10-20 14:00+00");
  await pickRound([1, 2], "2026-10-20 15:00+00");
  await setNow(db, "2026-10-21 20:00+00");
  await feedRound([1, 2]);
  await pickRound([3, 4], "2026-10-21 21:00+00");
  await pickRound([3, 4], "2026-10-21 22:00+00");
  await pickRound([3, 4], "2026-10-21 23:00+00");
  await setNow(db, "2026-10-22 20:30+00");
  await feedRound([3, 4]);
  await pickRound([5, 6], "2026-10-22 21:00+00");
  await pickRound([5, 6], "2026-10-22 22:00+00");
  await pickRound([5, 6], "2026-10-22 23:00+00");
  await setNow(db, "2026-10-24 21:00+00");
  await feedRound([5, 6]);
  return stats;
}

describe("M1-B scoring: random events, app vs oracle", () => {
  for (const [i, s] of [SEED + 1, SEED + 2].entries()) {
    it(`event ${i + 1} (seed ${s}): picks, results, points, bracket and standings all agree`, async () => {
      const stats = await runEvent(s, 300, 9);
      console.log(JSON.stringify({ section: "M1-B", ...stats }, null, 1));
      expect(stats.pickAcceptMismatch).toBe(0);
      expect(stats.resultMismatch).toBe(0);
      expect(stats.storedPickMismatch).toBe(0);
      expect(stats.scoreMismatch).toBe(0);
      expect(stats.winPointsMismatch).toBe(0);
      expect(stats.bracketMismatch).toBe(0);
      expect(stats.standingsMismatch).toBe(0);
    }, 900_000);
  }
});

void one;

// Postgres array text of the oracle's flags (PGlite's boolean[] parser turns NULL into false).
function flagsText(f: (boolean | null)[] | null): string | null {
  return f === null ? null : `{${f.map((x) => (x === null ? "NULL" : x ? "t" : "f")).join(",")}}`;
}

describe("M1-D deciding set", () => {
  it('deciding_set other than "full": SQL, client and oracle all refuse every pick, and a completed result is rejected (no guessing)', async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(1)");
    await db.query(
      `update public.event_config set rules = jsonb_set(rules, '{deciding_set}', '"match_tiebreak"')`,
    );
    const r2 = { ...rules, deciding_set: "match_tiebreak" };
    const sc = [
      { p1_games: 6, p2_games: 4 },
      { p1_games: 3, p2_games: 6 },
      { p1_games: 6, p2_games: 3 },
    ];
    const sql = await one<{ e: string | null }>(
      db,
      "select public.validate_set_scores(1, 3, $1::jsonb) as e",
      [JSON.stringify(sc)],
    );
    expect(sql.e).toBe("deciding_set_mode_not_supported");
    expect(validateSetScores(r2 as ScoreRules, 1, 3, sc)).toBe("deciding_set_mode_not_supported");
    expect(pickValidity(r2, 1, 3, toPairs(sc)).ok).toBe(false);
    const pick = await savePicks(db, [
      {
        uid: uid(1),
        match: 1,
        winner: "c",
        sets: 2,
        scores: [
          { p1_games: 6, p2_games: 4 },
          { p1_games: 6, p2_games: 4 },
        ],
      },
    ]);
    expect(pick.errors[0]).toContain("deciding_set_mode_not_supported");
    await setNow(db, "2026-10-21 20:00+00");
    const out = await ingest(
      db,
      payload(
        1,
        "c",
        "f",
        "completed",
        1,
        [
          [6, 4],
          [6, 4],
        ],
        false,
      ),
    );
    expect(out.outcome).toBe("rejected_invalid");
  }, 120_000);
});
