// Q2 — the match schedule (full-debug brief, Part 2, section Q2).
// Prints the six start times from supabase/events/sixkings_2026_draw.sql in UTC and Riyadh time and
// checks only internal consistency. It cannot confirm the official schedule: that is for Tino.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, loadRealDraw, one } from "./_db";

type M = {
  match_no: number;
  round: string;
  p1: string;
  p2: string;
  starts_at: Date;
  utc: string;
  riyadh: string;
  night: string;
};

let db: PGlite;
let ms: M[];
beforeAll(async () => {
  db = await freshDb();
  await loadRealDraw(db);
  ms = (
    await db.query<M>(`
      select m.match_no, m.round,
             coalesce(m.p1_id, (m.p1_source->>'type') || ' ' || (m.p1_source->>'match')) as p1,
             coalesce(m.p2_id, (m.p2_source->>'type') || ' ' || (m.p2_source->>'match')) as p2,
             m.starts_at,
             to_char(m.starts_at at time zone 'UTC', 'Dy DD Mon HH24:MI') as utc,
             to_char(m.starts_at at time zone 'Asia/Riyadh', 'Dy DD Mon HH24:MI') as riyadh,
             to_char(m.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as night
        from public.matches m order by m.match_no`)
  ).rows;
  console.table(ms.map(({ starts_at: _s, ...r }) => r));
}, 60_000);
afterAll(async () => db?.close());

describe("Q2 schedule: internal consistency only", () => {
  test("every match has a start time; the event's timezone is Asia/Riyadh", async () => {
    expect(ms.length).toBe(6);
    expect(ms.every((m) => m.starts_at)).toBe(true);
    expect(await one(db, "select timezone from public.event_config")).toBe("Asia/Riyadh");
  });

  test("three nights: QFs 21 Oct, SFs 22 Oct, 3rd place + final 24 Oct (Riyadh dates)", () => {
    const byNight = Object.groupBy(ms, (m) => m.night);
    expect(Object.keys(byNight).sort()).toEqual(["2026-10-21", "2026-10-22", "2026-10-24"]);
    expect(byNight["2026-10-21"]!.map((m) => m.round)).toEqual(["QF", "QF"]);
    expect(byNight["2026-10-22"]!.map((m) => m.round)).toEqual(["SF", "SF"]);
    expect(byNight["2026-10-24"]!.map((m) => m.round)).toEqual(["3P", "F"]);
  });

  test("every match starts after the matches that feed it (no SF before its QF, no final before both SFs)", async () => {
    const feeds = (
      await db.query<{ m: number; src: number }>(`
        select match_no m, (s->>'match')::int src
          from public.matches, lateral (values (p1_source), (p2_source)) v(s)
         where s->>'type' in ('winner', 'loser')`)
    ).rows;
    const at = new Map(ms.map((m) => [m.match_no, +new Date(m.starts_at)]));
    const bad = feeds.filter((f) => !(at.get(f.m)! > at.get(f.src)!));
    expect(bad).toEqual([]);
    // and a feeder ends on an earlier night (a best-of-3 can run past 2 h)
    const night = new Map(ms.map((m) => [m.match_no, m.night]));
    expect(feeds.filter((f) => night.get(f.m)! <= night.get(f.src)!)).toEqual([]);
  });

  test("match numbers run in start order", () => {
    const sorted = [...ms].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    expect(sorted.map((m) => m.match_no)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("gaps between the two matches of each night (report): 70, 110 and 130 minutes", () => {
    const gap = (a: number, b: number) =>
      (+new Date(ms[b - 1]!.starts_at) - +new Date(ms[a - 1]!.starts_at)) / 60_000;
    // Not a rule, a record for Tino: the draw file's comment says "19:30 / ~20:40 Riyadh, the
    // 2024–25 pattern", but only night 1 follows it; nights 2 and 3 use 21:20 and 21:40.
    expect([gap(1, 2), gap(3, 4), gap(5, 6)]).toEqual([70, 110, 130]);
  });

  test("every night starts at 19:30 Riyadh; no match starts after 22:00 Riyadh", () => {
    expect(ms.filter((_, i) => i % 2 === 0).map((m) => m.riyadh.slice(-5))).toEqual([
      "19:30",
      "19:30",
      "19:30",
    ]);
    expect(ms.filter((m) => m.riyadh.slice(-5) > "22:00")).toEqual([]);
  });

  test("the billing window still ends after the final (organiser-era field, see Q3)", async () => {
    const close = await one<Date>(db, "select billing_close_at from public.event_config");
    expect(+close).toBeGreaterThan(+new Date(ms[5]!.starts_at));
  });
});

describe("Q2 ranks behind the upset bonus (same file: they freeze with the schedule)", () => {
  test("ranks are placeholders (rank_snapshot_date is null) and launch_at is null", async () => {
    expect(await one(db, "select rank_snapshot_date from public.event_config")).toBeNull();
    expect(await one(db, "select launch_at from public.event_config")).toBeNull();
  });

  // Characterisation (passes): once ONE pick exists, ranks can no longer change. The draw file says the
  // ranks are placeholders until the ATP ranking of 12 Oct; nothing stops picks before then (save_pick
  // does not read launch_at), so loading this file on production before the real ranks freezes the
  // placeholders into the upset bonus for good.
  test("RISK after one pick, set_players refuses new ranks (picks_exist_players_frozen)", async () => {
    await db.exec("select t.new_user(1)");
    expect(await one(db, "select t.pick(t.uid(1), 1, 'fritz', '6-4 6-4')")).toBeNull();
    const err = await one(
      db,
      `select t.err($$ select public.set_players(
         (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'rank', rank_snapshot + 1)) from public.players)) $$)`,
    );
    expect(String(err)).toContain("picks_exist_players_frozen");
  });
});
