// M6 — re-settlement: a result corrected after settling (result_rev) rescoring exactly once.
//   · after each correction every pick equals the oracle, standings equal the oracle and equal a fresh
//     recompute run by hand (twice), standings.points = Σ pts_total, scored_rev = result_rev;
//   · correcting and then reverting gives back byte-identical scores and standings;
//   · re-sending the same result changes nothing (result_rev unchanged).
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  gamesIn,
  loadEventRules,
  rankFans,
  scorePick,
  type Fan,
  type Result,
  type Round,
  type Set,
  type Slot,
} from "../oracle";
import {
  boot,
  freshRecompute,
  ingest,
  matches,
  payload,
  prng,
  q,
  savePicks,
  seedOf,
  SEED,
  setNow,
  uid,
} from "./harness";
import { legalMatch } from "./gen";

const rules = loadEventRules();
const RANKS: Record<string, number> = { a: 1, b: 2, c: 3, d: 5, e: 7, f: 10 };
let db: PGlite;
afterAll(async () => {
  await db?.close();
});
const S = (t: string): Set[] => t.split(" ").map((x) => x.split("-").map(Number) as Set);

describe("M6 re-settlement", () => {
  it("corrections rescore exactly once, match the oracle and a fresh recompute, and revert cleanly", async () => {
    const rng = prng(SEED + 60);
    db = await boot();
    await db.query("select t.setup_event()");
    const U = 80;
    await db.query(`select t.new_user(n) from generate_series(1, ${U}) n`);
    const picks = new Map<string, { winner: Slot; sets: Set[]; at: number }>();
    const results = new Map<number, Result>();
    const pairs = new Map<number, [string, string, Round]>();

    const pickAll = async (ms: number[], at: string) => {
      await setNow(db, at);
      const mm = await matches(db);
      const rows: Parameters<typeof savePicks>[1] = [];
      const meta: { key: string; winner: Slot; sets: Set[] }[] = [];
      for (let u = 1; u <= U; u++)
        for (const m of ms) {
          if (rng.chance(0.1)) continue;
          const w = rng.pick([1, 2] as const);
          const sets = legalMatch(rules, rng, w, rng.chance(0.5) ? 2 : 3);
          const x = mm.find((y) => y.match_no === m)!;
          rows.push({
            uid: uid(u),
            match: m,
            winner: w === 1 ? x.p1_id : x.p2_id,
            sets: sets.length,
            scores: sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
          });
          meta.push({ key: `${uid(u)}:${m}`, winner: w, sets });
        }
      const r = await savePicks(db, rows);
      expect(r.errors.every((e) => e === null)).toBe(true);
      const t = Date.parse(r.at.replace(" ", "T").replace(/\+00$/, "Z"));
      for (const x of meta) picks.set(x.key, { winner: x.winner, sets: x.sets, at: t });
    };
    const feed = async (m: number, r: Result, flip = false) => {
      const x = (await matches(db)).find((y) => y.match_no === m)!;
      pairs.set(m, [x.p1_id!, x.p2_id!, x.round]);
      const out = await ingest(
        db,
        payload(m, x.p1_id!, x.p2_id!, r.status, r.winner, r.sets, flip),
      );
      if (out.outcome === "settled" || out.outcome === "resettled") results.set(m, r);
      return out.outcome;
    };
    const snapshot = async () => ({
      picks: await q(
        db,
        `select user_id, match_no, pts_winner, pts_sets, pts_exact, exact_sets, pts_total, exact_flags::text as f from public.picks order by user_id, match_no`,
      ),
      standings: await q(
        db,
        `select user_id, points, exact_sets, final_games_gap, final_pick_at::text, rank from public.standings order by user_id`,
      ),
    });
    const invariants = async () => {
      const bad1 = await q(
        db,
        `select s.user_id from public.standings s
           where s.points <> coalesce((select sum(pts_total) from public.picks p where p.user_id = s.user_id), 0)
              or s.exact_sets <> coalesce((select sum(exact_sets) from public.picks p where p.user_id = s.user_id), 0)`,
      );
      const bad2 = await q(
        db,
        `select p.user_id from public.picks p join public.matches m using (match_no)
           where m.status <> 'scheduled' and p.scored_rev is distinct from m.result_rev`,
      );
      expect(bad1).toEqual([]);
      expect(bad2).toEqual([]);
      // oracle: every scored pick and the whole table
      const seed = await seedOf(db);
      const fans: Fan[] = [];
      for (let u = 1; u <= U; u++) {
        let points = 0;
        let exactSets = 0;
        for (const [m, r] of results) {
          const p = picks.get(`${uid(u)}:${m}`);
          if (!p) continue;
          const [p1, p2, round] = pairs.get(m)!;
          const s = scorePick(rules, round, [RANKS[p1]!, RANKS[p2]!], r, p);
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
      const f = results.get(6);
      const order = rankFans(fans, f && f.status === "completed" ? gamesIn(f.sets) : null, seed);
      const st = await q<{ user_id: string; points: number; rank: number }>(
        db,
        "select user_id, points, rank from public.standings order by rank",
      );
      expect(st.map((s) => [s.user_id, s.points])).toEqual(order.map((o) => [o.id, o.points]));
      // a fresh recompute (rescore every settled match + rebuild standings), twice, changes nothing
      const before = await snapshot();
      await freshRecompute(db, [...results.keys()]);
      await freshRecompute(db, [...results.keys()]);
      expect(await snapshot()).toEqual(before);
    };

    await pickAll([1, 2], "2026-10-20 13:00+00");
    await setNow(db, "2026-10-21 20:00+00");
    expect(await feed(1, { status: "completed", winner: 2, sets: S("4-6 6-3 4-6") })).toBe(
      "settled",
    );
    const qf2: Result = { status: "completed", winner: 1, sets: S("6-4 6-3") };
    expect(await feed(2, qf2)).toBe("settled");
    await pickAll([3, 4], "2026-10-21 21:00+00");
    await setNow(db, "2026-10-22 20:30+00");
    expect(await feed(3, { status: "completed", winner: 1, sets: S("6-4 4-6 6-3") })).toBe(
      "settled",
    );
    expect(await feed(4, { status: "retired", winner: 1, sets: S("6-4 2-1") })).toBe("settled");
    await pickAll([5, 6], "2026-10-22 21:00+00");
    await setNow(db, "2026-10-24 21:00+00");
    expect(await feed(5, { status: "walkover", winner: 2, sets: [] })).toBe("settled");
    const fin: Result = { status: "completed", winner: 1, sets: S("7-6 6-4") };
    expect(await feed(6, fin)).toBe("settled");
    await invariants();
    const S0 = await snapshot();
    const rev = async (m: number) => (await matches(db)).find((x) => x.match_no === m)!.result_rev;
    expect(await rev(2)).toBe(1);

    // 1. QF2 corrected: same winner, three sets instead of two (sets points and exact sets move)
    expect(await feed(2, { status: "completed", winner: 1, sets: S("6-4 3-6 6-3") }, true)).toBe(
      "resettled",
    );
    expect(await rev(2)).toBe(2);
    await invariants();
    // the same reading again, from the other side: nothing changes
    expect(await feed(2, { status: "completed", winner: 1, sets: S("6-4 3-6 6-3") }, false)).toBe(
      "unchanged",
    );
    expect(await rev(2)).toBe(2);
    // 2. the final's winner corrected, then its status (retirement), then back to the original
    expect(await feed(6, { status: "completed", winner: 2, sets: S("6-7 4-6") })).toBe("resettled");
    await invariants();
    expect(await feed(6, { status: "retired", winner: 1, sets: S("7-6 3-1") })).toBe("resettled");
    await invariants();
    expect(await feed(6, fin)).toBe("resettled");
    expect(await feed(2, qf2)).toBe("resettled");
    await invariants();
    expect(await rev(2)).toBe(3);
    expect(await rev(6)).toBe(4);
    // reverted: byte-identical to the first settlement
    expect(await snapshot()).toEqual(S0);
  }, 300_000);
});
