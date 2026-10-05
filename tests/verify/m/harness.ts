// Section M test harness: a fresh in-process PGlite database (every migration, the simulated clock, the
// event file and supabase/tests/_prelude.sql) plus a few TEST-ONLY helpers in a private schema "mv".
// Nothing here is product code and nothing touches the shared local Supabase stack.
import type { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb } from "../../../scripts/lib/db";
import type { Set, Slot, Status } from "../oracle";

const HELPERS = /* sql */ `
create schema mv;

-- Save a pick as a fan through the real RPC; null on success, otherwise the error text.
create function mv.pick(p_uid uuid, p_match int, p_winner text, p_sets int, p_scores jsonb) returns text
language plpgsql as $$
declare v_err text;
begin
  perform t.as_user(p_uid);
  begin
    perform public.save_pick(p_match, p_winner, p_sets, p_scores);
  exception when others then v_err := sqlerrm;
  end;
  perform t.as_owner();
  return v_err;
end $$;

-- A provider payload through the real ingest RPC, as the service role (the poller's role).
create function mv.ingest(p_provider text, p_norm jsonb) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform t.as_service();
  v := public.ingest_result(p_provider, p_norm, jsonb_build_object('raw', p_norm));
  perform t.as_owner();
  return v;
end $$;

-- Operator calls as the service role.
create function mv.svc(p_sql text) returns text
language plpgsql as $$
declare v_err text;
begin
  perform t.as_service();
  v_err := t.err(p_sql);
  perform t.as_owner();
  return v_err;
end $$;
`;

export async function boot(): Promise<PGlite> {
  const db = await bootDb({ prelude: true });
  await db.exec(HELPERS);
  // M_APPLY_PROPOSED=1: apply the proposed scoring patches (tests/verify/proposed/m-*.patch, plain SQL)
  // on top of the migrations, to show the failing tests pass with them. Never applied otherwise.
  if (process.env["M_APPLY_PROPOSED"]) {
    const dir = join(import.meta.dir, "..", "proposed");
    for (const f of readdirSync(dir)
      .filter((x) => x.startsWith("m-") && x.endsWith(".patch"))
      .sort())
      await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

// mulberry32: a tiny seeded PRNG so every run is reproducible from the printed seed.
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof prng>;
export const SEED = Number(process.env["M_SEED"] ?? 20261005);

export const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const toJson = (sets: Set[]) => sets.map(([a, b]) => ({ p1_games: a, p2_games: b }));
export const fromJson = (j: { p1_games: number; p2_games: number }[] | null): Set[] =>
  (j ?? []).map((s) => [s.p1_games, s.p2_games]);

export async function q<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows;
}
export async function one<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
) {
  return (await q<T>(db, sql, params))[0]!;
}
export const setNow = (db: PGlite, at: string) => db.query("select public.dev_set_now($1)", [at]);

export type MatchRow = {
  match_no: number;
  round: "QF" | "SF" | "3P" | "F";
  p1_id: string | null;
  p2_id: string | null;
  p1_win_points: number | null;
  p2_win_points: number | null;
  status: string;
  winner_id: string | null;
  set_scores: { p1_games: number; p2_games: number }[] | null;
  result_rev: number;
  settlement_paused: boolean;
  started_at: string | null;
};
export const matches = async (db: PGlite) =>
  q<MatchRow>(db, "select * from public.matches order by match_no");

/** Players with ids a..f as in the prelude's bracket, but with the given ranks (before any pick). */
export async function setRanks(db: PGlite, ranks: Record<string, number>) {
  const players = Object.entries(ranks).map(([id, rank], i) => ({
    id,
    name: `Player ${id.toUpperCase()}`,
    seed: i + 1,
    rank,
  }));
  const err = await one<{ e: string | null }>(
    db,
    "select mv.svc(format('select public.set_players(%L::jsonb)', $1::text)) as e",
    [JSON.stringify(players)],
  );
  if (err.e) throw new Error(`set_players: ${err.e}`);
}

/** Saves many picks in ONE statement (one transaction: every save shares the same app_now()). */
export async function savePicks(
  db: PGlite,
  rows: {
    uid: string;
    match: number;
    winner: string | null;
    sets: number | null;
    scores: unknown;
  }[],
): Promise<{ at: string; errors: (string | null)[] }> {
  if (rows.length === 0) return { at: "", errors: [] };
  const payload = rows.map((r, i) => ({
    i,
    uid: r.uid,
    m: r.match,
    w: r.winner,
    s: r.sets,
    sc: r.scores === undefined ? null : r.scores,
  }));
  const res = await one<{ at: string; errs: { i: number; e: string | null }[] }>(
    db,
    `with x as (select * from jsonb_to_recordset($1::jsonb) as x(i int, uid uuid, m int, w text, s int, sc jsonb)),
          r as (select x.i, mv.pick(x.uid, x.m, x.w, x.s, x.sc) as e from x order by x.i)
     select (select public.app_now())::text as at, (select jsonb_agg(r order by r.i) from r) as errs`,
    [JSON.stringify(payload)],
  );
  return { at: res.at, errors: res.errs.map((e) => e.e) };
}

/** A provider result, in our player order or flipped (the provider lists player 2 first). */
export function payload(
  match: number,
  p1: string,
  p2: string,
  status: Status,
  winner: Slot,
  sets: Set[],
  flip: boolean,
) {
  const provSets = flip ? sets.map(([a, b]) => [b, a] as Set) : sets;
  return {
    match_ref: `fx-m${match}`,
    status,
    players: flip ? [`fx-${p2}`, `fx-${p1}`] : [`fx-${p1}`, `fx-${p2}`],
    winner: `fx-${winner === 1 ? p1 : p2}`,
    set_scores: toJson(provSets),
  };
}
export async function ingest(db: PGlite, norm: unknown, provider = "fixture") {
  const r = await one<{ r: { outcome: string; reason: string | null } }>(
    db,
    "select mv.ingest($1, $2::jsonb) as r",
    [provider, JSON.stringify(norm)],
  );
  return r.r;
}

export type PickRow = {
  user_id: string;
  match_no: number;
  winner_id: string;
  sets: number;
  set_scores: { p1_games: number; p2_games: number }[];
  updated_at: string;
  pts_winner: number | null;
  pts_sets: number | null;
  pts_exact: number | null;
  exact_sets: number | null;
  pts_total: number | null;
  exact_flags: (boolean | null)[] | null;
  scored_rev: number | null;
};
export type StandRow = {
  user_id: string;
  points: number;
  exact_sets: number;
  final_games_gap: number | null;
  final_pick_at: string | null;
  rank: number | null;
};
export const standings = (db: PGlite) =>
  q<StandRow>(db, "select * from public.standings order by rank nulls last, user_id");
export const seedOf = async (db: PGlite) =>
  (await one<{ s: string }>(db, "select tiebreak_seed as s from public.event_config")).s;

/** Re-run the settlement steps by hand as the owner (idempotence checks only; never in the app path). */
export async function freshRecompute(db: PGlite, matchesToRescore: number[] = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('skg.settling', '1', true)");
    for (const m of matchesToRescore) await db.query("select public.score_match($1)", [m]);
    await db.query("select public.recompute_standings()");
    await db.exec("commit");
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
