// M4 — the tiebreak chain exactly as How to play describes it, with 4-way ties built to reach each level:
//   points → 1 sets exactly right → 2 final total games closest → 3 earliest final pick (last change)
//   → 4 the seeded draw (md5(tiebreak_seed || ':' || user_id), recomputed here with node:crypto).
// Plus: the final ending in a retirement skips level 2; the seed guard; a void final pick in the tiebreak.
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  compareFans,
  drawNumber,
  gamesIn,
  loadEventRules,
  pickValidity,
  rankFans,
  scorePick,
  type Fan,
  type Level,
  type Result,
  type Round,
  type Set,
  type Slot,
} from "../oracle";
import {
  boot,
  ingest,
  matches,
  one,
  payload,
  q,
  savePicks,
  seedOf,
  setNow,
  standings,
  uid,
} from "./harness";

const rules = loadEventRules();
const dbs: PGlite[] = [];
afterAll(async () => {
  for (const d of dbs) await d.close();
});

const RANKS: Record<string, number> = { a: 1, b: 2, c: 3, d: 5, e: 7, f: 10 }; // the prelude's players
const S = (t: string): Set[] => t.split(" ").map((x) => x.split("-").map(Number) as Set);
// The event's results (our player order). QF1 c v f · QF2 d v e · SF1 a v c · SF2 b v d · 3P c v d · F a v b
const RESULTS: Record<number, Result> = {
  1: { status: "completed", winner: 1, sets: S("6-4 3-6 6-3") },
  2: { status: "completed", winner: 1, sets: S("6-4 6-3") },
  3: { status: "completed", winner: 1, sets: S("6-4 4-6 6-3") },
  4: { status: "completed", winner: 1, sets: S("6-3 6-3") },
  5: { status: "completed", winner: 1, sets: S("6-4 6-4") },
  6: { status: "completed", winner: 1, sets: S("6-4 6-4") }, // 20 games
};
const PAIRS: Record<number, [string, string, Round]> = {
  1: ["c", "f", "QF"],
  2: ["d", "e", "QF"],
  3: ["a", "c", "SF"],
  4: ["b", "d", "SF"],
  5: ["c", "d", "3P"],
  6: ["a", "b", "F"],
};
type P = { winner: Slot; sets: Set[] };
const score = (m: number, p: P) => {
  const [p1, p2, round] = PAIRS[m]!;
  return scorePick(rules, round, [RANKS[p1]!, RANKS[p2]!], RESULTS[m]!, p);
};

/** Every legal pick on a match (both winners, 2 and 3 sets). */
function allPicks(): P[] {
  const out: P[] = [];
  const L = rules.allowed_set_scores;
  const set = (w: Slot, [a, b]: [number, number]): Set => (w === 1 ? [a, b] : [b, a]);
  for (const w of [1, 2] as Slot[]) {
    const l: Slot = w === 1 ? 2 : 1;
    for (const x of L) for (const y of L) out.push({ winner: w, sets: [set(w, x), set(w, y)] });
    for (const first of [w, l])
      for (const x of L)
        for (const y of L)
          for (const z of L)
            out.push({ winner: w, sets: [set(first, x), set(first === w ? l : w, y), set(w, z)] });
  }
  return out.filter((p) => pickValidity(rules, p.winner, p.sets.length, p.sets).ok);
}

/** 4 combinations of picks on matches 1–4 with the same points and 4 different exact-set counts. */
function exactGroup(): P[][] {
  const cands = allPicks();
  let states = new Map<string, P[]>([["0|0", []]]);
  for (const m of [1, 2, 3, 4]) {
    const opts = new Map<string, P>();
    for (const p of cands) {
      const s = score(m, p);
      const k = `${s.total}|${s.exactSets}`;
      if (!opts.has(k)) opts.set(k, p);
    }
    const next = new Map<string, P[]>();
    for (const [k, combo] of states) {
      const [t, e] = k.split("|").map(Number);
      for (const [ok, p] of opts) {
        const [ot, oe] = ok.split("|").map(Number);
        const nk = `${t! + ot!}|${e! + oe!}`;
        if (!next.has(nk)) next.set(nk, [...combo, p]);
      }
    }
    states = next;
  }
  const byTotal = new Map<number, Map<number, P[]>>();
  for (const [k, combo] of states) {
    const [t, e] = k.split("|").map(Number);
    if (!byTotal.has(t!)) byTotal.set(t!, new Map());
    byTotal.get(t!)!.set(e!, combo);
  }
  const best = [...byTotal.entries()]
    .filter(([, es]) => es.size >= 4)
    .sort((a, b) => b[0] - a[0])[0]!;
  return [...best[1].values()].slice(0, 4);
}

async function boardMatchesOracle(db: PGlite, fans: Map<string, Fan>, finalTotal: number | null) {
  const seed = await seedOf(db);
  const order = rankFans([...fans.values()], finalTotal, seed).map((f) => f.id);
  const st = await standings(db);
  return { order, db: st.map((s) => s.user_id), st };
}

describe("M4 tiebreak chain", () => {
  it("4-way ties decided at each level (exact sets, final games gap, final pick time, seeded draw) rank exactly as the oracle says", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    const groups = {
      exact: [1, 2, 3, 4],
      gap: [11, 12, 13, 14],
      time: [21, 22, 23, 24],
      draw: [31, 32, 33, 34],
      noFinal: [40],
    };
    const all = Object.values(groups).flat();
    await db.query(`select t.new_user(n) from unnest($1::int[]) n`, [all]);
    const fanPicks = new Map<string, Map<number, P & { at: number }>>();
    const save = async (rows: { u: number; m: number; p: P }[], at: string) => {
      await setNow(db, at);
      const mm = await matches(db);
      const r = await savePicks(
        db,
        rows.map(({ u, m, p }) => {
          const x = mm.find((y) => y.match_no === m)!;
          return {
            uid: uid(u),
            match: m,
            winner: p.winner === 1 ? x.p1_id : x.p2_id,
            sets: p.sets.length,
            scores: p.sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
          };
        }),
      );
      expect(r.errors.every((e) => e === null)).toBe(true);
      const t = Date.parse(r.at.replace(" ", "T").replace(/\+00$/, "Z"));
      for (const { u, m, p } of rows) {
        if (!fanPicks.has(uid(u))) fanPicks.set(uid(u), new Map());
        fanPicks.get(uid(u))!.set(m, { ...p, at: t });
      }
    };
    const feed = async (m: number) => {
      const mm = (await matches(db)).find((x) => x.match_no === m)!;
      const r = RESULTS[m]!;
      expect(
        (
          await ingest(
            db,
            payload(m, mm.p1_id!, mm.p2_id!, r.status, r.winner, r.sets, m % 2 === 0),
          )
        ).outcome,
      ).toBe("settled");
    };

    const eg = exactGroup();
    await save(
      eg.flatMap((combo, i) =>
        combo.slice(0, 2).map((p, k) => ({ u: groups.exact[i]!, m: k + 1, p })),
      ),
      "2026-10-20 13:00+00",
    );
    await setNow(db, "2026-10-21 20:00+00");
    await feed(1);
    await feed(2);
    await save(
      eg.flatMap((combo, i) =>
        combo.slice(2, 4).map((p, k) => ({ u: groups.exact[i]!, m: k + 3, p })),
      ),
      "2026-10-21 21:00+00",
    );
    await setNow(db, "2026-10-22 20:30+00");
    await feed(3);
    await feed(4);
    // Final picks, all on the wrong winner (b) so they score 0: only the tiebreakers separate them.
    // gap group: 20 (gap 0), 21 (1), 23 (3), 26 (6) games; final result has 20.
    await save(
      [S("4-6 4-6"), S("2-6 6-7"), S("4-6 6-7"), S("6-7 6-7")].map((sets, i) => ({
        u: groups.gap[i]!,
        m: 6,
        p: { winner: 2 as Slot, sets },
      })),
      "2026-10-22 21:00+00",
    );
    // time group: identical 22-game picks at four different moments; draw group: identical, same moment.
    for (const [i, at] of [
      "2026-10-22 22:00+00",
      "2026-10-22 22:10+00",
      "2026-10-22 22:20+00",
      "2026-10-22 22:30+00",
    ].entries())
      await save([{ u: groups.time[3 - i]!, m: 6, p: { winner: 2, sets: S("5-7 4-6") } }], at);
    await save(
      groups.draw.map((u) => ({ u, m: 6, p: { winner: 2 as Slot, sets: S("5-7 4-6") } })),
      "2026-10-22 23:00+00",
    );
    await setNow(db, "2026-10-24 21:00+00");
    await feed(5);
    await feed(6);

    const fansFor = (final: Result) => {
      const fans = new Map<string, Fan>();
      for (const u of all) {
        const id = uid(u);
        const ps = fanPicks.get(id) ?? new Map();
        let points = 0;
        let exactSets = 0;
        for (const [m, p] of ps) {
          const r = m === 6 ? final : RESULTS[m]!;
          const [p1, p2, round] = PAIRS[m]!;
          const s = scorePick(rules, round, [RANKS[p1]!, RANKS[p2]!], r, p);
          points += s.total;
          exactSets += s.exactSets;
        }
        const fp = ps.get(6);
        fans.set(id, {
          id,
          points,
          exactSets,
          finalGames: fp ? gamesIn(fp.sets) : null,
          finalPickAt: fp ? fp.at : null,
        });
      }
      return fans;
    };

    const seed = await seedOf(db);
    const fans = fansFor(RESULTS[6]!);
    const levelsInside = (ids: number[], total: number | null) => {
      const f = rankFans(
        ids.map((u) => fans.get(uid(u))!),
        total,
        seed,
      );
      const lv: Level[] = [];
      for (let i = 1; i < f.length; i++) lv.push(compareFans(f[i - 1]!, f[i]!, total, seed).level);
      return lv;
    };
    expect(new globalThis.Set(groups.exact.map((u) => fans.get(uid(u))!.points)).size).toBe(1);
    expect(levelsInside(groups.exact, 20)).toEqual(["exact", "exact", "exact"]);
    expect(levelsInside(groups.gap, 20)).toEqual(["gap", "gap", "gap"]);
    expect(levelsInside(groups.time, 20)).toEqual(["time", "time", "time"]);
    expect(levelsInside(groups.draw, 20)).toEqual(["draw", "draw", "draw"]);

    const b1 = await boardMatchesOracle(db, fans, 20);
    // the draw group's order recomputed independently: ascending md5(seed:id)
    const drawOrder = [...groups.draw]
      .map(uid)
      .sort((x, y) => (drawNumber(seed, x) < drawNumber(seed, y) ? -1 : 1));
    const dbDraw = b1.db.filter((id) => drawOrder.includes(id));
    console.log(
      JSON.stringify({
        section: "M4.1",
        exactGroup: groups.exact.map((u) => ({ u, ...fans.get(uid(u)) })),
        oracle: b1.order.map((x) => x.slice(-2)),
        db: b1.db.map((x) => x.slice(-2)),
        drawOrder: drawOrder.map((x) => x.slice(-2)),
        dbDraw: dbDraw.map((x) => x.slice(-2)),
      }),
    );
    expect(b1.db).toEqual(b1.order);
    expect(dbDraw).toEqual(drawOrder);
    expect(b1.st.map((s) => s.rank)).toEqual(all.map((_, i) => i + 1));

    // The final is corrected to a retirement: level 2 is skipped for everyone, level 3 then decides.
    const ret: Result = { status: "retired", winner: 1, sets: S("6-4 2-1") };
    const mm = (await matches(db)).find((x) => x.match_no === 6)!;
    expect(
      (await ingest(db, payload(6, mm.p1_id!, mm.p2_id!, ret.status, ret.winner, ret.sets, false)))
        .outcome,
    ).toBe("resettled");
    const fansR = fansFor(ret);
    const b2 = await boardMatchesOracle(db, fansR, null);
    expect(b2.st.every((s) => s.final_games_gap === null)).toBe(true);
    expect(b2.db).toEqual(b2.order);
  }, 300_000);

  it("guard_tiebreak_seed: the seed can change before the first match starts and an UPDATE is refused after", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    const upd = (s: string) =>
      one<{ e: string | null }>(
        db,
        "select mv.svc(format('update public.event_config set tiebreak_seed = %L where id', $1::text)) as e",
        [s],
      );
    expect((await upd("before-start")).e).toBeNull();
    // launch_at in the past but no match started: still changeable (see the report: "after launch" vs
    // "fixed before the first match")
    await db.query("update public.event_config set launch_at = '2026-10-15 00:00+00'");
    expect((await upd("after-launch-before-first-match")).e).toBeNull();
    await setNow(db, "2026-10-21 16:30+00"); // QF1's start, nothing settled yet
    expect((await upd("at-start")).e).toBe("tiebreak_seed_locked");
    expect(await seedOf(db)).toBe("after-launch-before-first-match");
    // an update that rewrites every column but keeps the seed still works (the event file's upsert)
    expect(
      (
        await one<{ e: string | null }>(
          db,
          "select mv.svc('update public.event_config set name = name where id') as e",
        )
      ).e,
    ).toBeNull();
  }, 120_000);

  it("BUG (fails today): after play starts the service role can still replace the seed by DELETE + INSERT of event_config", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await setNow(db, "2026-10-21 17:00+00");
    const before = await seedOf(db);
    const err = (
      await one<{ e: string | null }>(
        db,
        `select mv.svc($s$
             with old as (delete from public.event_config where id returning *)
             insert into public.event_config (id, name, timezone, rules, tiebreak_seed)
             select id, name, timezone, rules, 'chosen-after-the-start' from old
           $s$) as e`,
      )
    ).e;
    const after = await seedOf(db);
    console.log(JSON.stringify({ section: "M4.3", before, after, err }));
    expect(after).toBe(before);
  }, 120_000);

  it("BUG (fails today): a final pick saved after the final really started is void for points but still wins tiebreaker 2", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(n) from generate_series(1, 2) n"); // 1 = V (late pick), 2 = W
    const W = uid(2);
    const V = uid(1);
    await setNow(db, "2026-10-21 20:00+00");
    for (const m of [1, 2]) {
      const x = (await matches(db)).find((y) => y.match_no === m)!;
      const r = RESULTS[m]!;
      expect(
        (await ingest(db, payload(m, x.p1_id!, x.p2_id!, r.status, r.winner, r.sets, false)))
          .outcome,
      ).toBe("settled");
    }
    await setNow(db, "2026-10-22 20:30+00");
    for (const m of [3, 4]) {
      const x = (await matches(db)).find((y) => y.match_no === m)!;
      const r = RESULTS[m]!;
      expect(
        (await ingest(db, payload(m, x.p1_id!, x.p2_id!, r.status, r.winner, r.sets, false)))
          .outcome,
      ).toBe("settled");
    }
    // W: a final pick before anything happened, wrong winner, 22 games (gap 2 from the real 20).
    await setNow(db, "2026-10-24 17:00+00");
    expect(
      (
        await savePicks(db, [
          {
            uid: W,
            match: 6,
            winner: "b",
            sets: 2,
            scores: [
              { p1_games: 5, p2_games: 7 },
              { p1_games: 4, p2_games: 6 },
            ],
          },
        ])
      ).errors[0],
    ).toBeNull();
    // The final really starts at 18:00, 40 minutes before its scheduled 18:40: the provider says "live".
    await setNow(db, "2026-10-24 18:00+00");
    const live = await ingest(db, {
      match_ref: "fx-m6",
      status: "live",
      players: ["fx-a", "fx-b"],
      winner: null,
      set_scores: [{ p1_games: 3, p2_games: 2 }],
    });
    expect(live.outcome).toBe("not_final");
    // V picks during the match (picks are still open until 18:40), 20 games: gap 0.
    await setNow(db, "2026-10-24 18:10+00");
    expect(
      (
        await savePicks(db, [
          {
            uid: V,
            match: 6,
            winner: "a",
            sets: 2,
            scores: [
              { p1_games: 6, p2_games: 4 },
              { p1_games: 6, p2_games: 4 },
            ],
          },
        ])
      ).errors[0],
    ).toBeNull();
    await setNow(db, "2026-10-24 21:00+00");
    const r6 = RESULTS[6]!;
    expect(
      (await ingest(db, payload(6, "a", "b", r6.status, r6.winner, r6.sets, false))).outcome,
    ).toBe("settled");

    const vPick = await one<{ pts_total: number }>(
      db,
      "select pts_total from public.picks where user_id = $1 and match_no = 6",
      [V],
    );
    const st = await q<{
      user_id: string;
      rank: number;
      final_games_gap: number | null;
      points: number;
    }>(db, "select user_id, rank, final_games_gap, points from public.standings order by rank");
    console.log(JSON.stringify({ section: "M4.4", vPick, standings: st }));
    expect(vPick.pts_total).toBe(0); // void: "a pick saved after it really started does not count"
    // Equal points (0 and 0). V's call does not count, so V has no call on the final and must rank
    // after W, who has one ([README] "With no call on the final, the fan ranks after everyone who has one").
    const rank = (id: string) => st.find((s) => s.user_id === id)!.rank;
    expect(st.find((s) => s.user_id === V)!.final_games_gap).toBeNull();
    expect(rank(W)).toBeLessThan(rank(V));
  }, 180_000);
});
