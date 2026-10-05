// Section N2 (+ N3 race): concurrent save_pick calls around the lock second, on REAL Postgres (PGlite is
// single-connection). Runs in a private throwaway database n_audit_<pid> on the local `supabase start`
// server, created and dropped here; the shared `postgres` database and its clock are never touched.
// app_now() is the production now() in that database (no sim clock): times are real, shifted relative
// to now() (Rule 5).
//   bun test tests/verify/n/concurrency.test.ts
// Skips itself when 127.0.0.1:55322 is not reachable. Tests named "BUG" FAIL today on purpose.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { createAuditDb, dropAuditDb, serverUp } from "./_pg";

const NAME = `n_audit_${process.pid}`;
const POOL = 30; // the shared server has max_connections = 100 and ~50 already in use by the stack
const up = await serverUp();
let sql: SQL;

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

type Call = {
  user: number;
  target: number; // planned server-time offset from the lock, ms
  winner: string;
  scores: string;
  txNow?: number; // the transaction's now() = what save_pick compares (epoch ms)
  ok?: boolean;
  err?: string;
};

// One round trip and one transaction per call, like a PostgREST RPC: t.timed_pick (created in this private
// database only) sets the fan's JWT claims and role, calls save_pick, and returns the transaction's now()
// with the outcome. The exception block only reports the error; it does not change what save_pick does.
const TIMED_PICK = `
create function t.timed_pick(p_uid uuid, p_match int, p_winner text, p_scores jsonb, out tx_ms float8, out err text)
language plpgsql as $f$
begin
  tx_ms := extract(epoch from now()) * 1000;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.save_pick(p_match, p_winner, 2, p_scores);
  exception when others then
    err := sqlerrm;
  end;
  execute 'reset role';
end $f$;`;

async function savePick(c: Call, match: number): Promise<void> {
  try {
    const [r] =
      await sql`select tx_ms, err from t.timed_pick(${uid(c.user)}::uuid, ${match}, ${c.winner}, ${c.scores}::text::jsonb)`;
    c.txNow = Number(r.tx_ms);
    c.ok = r.err === null;
    if (r.err !== null) c.err = String(r.err);
  } catch (e) {
    c.ok = false;
    c.err = (e as Error).message;
  }
}

async function serverOffsetMs(): Promise<number> {
  const before = Date.now();
  const [r] = await sql`select extract(epoch from clock_timestamp()) * 1000 as ms`;
  return Number(r.ms) - (before + Date.now()) / 2;
}

async function asService(q: string) {
  await sql.begin(async (tx) => {
    await tx`select t.as_service()`;
    await tx.unsafe(q);
  });
}

/** Fresh state for a round: no picks, match `m` starting at the next whole second ≥ lead ms away. */
async function resetRound(m: number, leadMs: number): Promise<number> {
  await sql.unsafe(`delete from picks; delete from activity_days;
    update matches set starts_at = now() + interval '1 day' where match_no in (1, 2);`);
  const [r] = await sql.unsafe(
    `select extract(epoch from date_trunc('second', clock_timestamp() + interval '${leadMs} milliseconds') + interval '1 second') * 1000 as ms`,
  );
  const lock = Number(r.ms);
  await asService(`select set_match_start(${m}, to_timestamp(${lock / 1000}))`);
  return lock;
}

const score = (k: number) => {
  const L = ["6-0", "6-1", "6-2", "6-3", "6-4", "7-5", "7-6"];
  const [a, b] = L[k % 7]!.split("-").map(Number);
  const [c, d] = L[Math.floor(k / 7) % 7]!.split("-").map(Number);
  return JSON.stringify([
    { p1_games: a, p2_games: b },
    { p1_games: c, p2_games: d },
  ]);
};

async function fire(calls: Call[], match: number, lock: number) {
  const off = await serverOffsetMs();
  // warm the pool so the calls near the lock do not wait for a TCP connect
  await Promise.all(Array.from({ length: POOL }, () => sql`select pg_sleep(0.02)`));
  await Promise.all(
    calls.map(async (c) => {
      await sleep(lock + c.target - off - Date.now());
      await savePick(c, match);
    }),
  );
}

async function storedPicks(match: number) {
  return (await sql`select user_id::text as u, winner_id as w, set_scores::text as s,
                          extract(epoch from updated_at) * 1000 as at from picks where match_no = ${match}`) as {
    u: string;
    w: string;
    s: string;
    at: string;
  }[];
}

function verdict(calls: Call[], lock: number) {
  const bad = calls.filter((c) => c.ok === undefined || (!c.ok && !/locked/.test(c.err ?? "")));
  const acceptedLate = calls.filter((c) => c.ok && c.txNow! >= lock);
  const rejectedEarly = calls.filter((c) => !c.ok && c.txNow !== undefined && c.txNow < lock);
  return {
    calls: calls.length,
    accepted: calls.filter((c) => c.ok).length,
    locked: calls.filter((c) => !c.ok && /locked/.test(c.err ?? "")).length,
    otherErrors: bad.map((c) => c.err),
    acceptedAfterLock: acceptedLate.length,
    rejectedBeforeLock: rejectedEarly.length,
    txNowSpreadMs: [
      Math.round(Math.min(...calls.map((c) => c.txNow! - lock))),
      Math.round(Math.max(...calls.map((c) => c.txNow! - lock))),
    ],
  };
}

describe.skipIf(!up)("N2 concurrent save_pick on real Postgres (private database)", () => {
  beforeAll(async () => {
    sql = await createAuditDb(NAME, POOL);
    await sql.begin(async (tx) => {
      await tx`select t.as_service()`;
      await tx.unsafe(`select set_players(
        '[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"b","name":"Player B","seed":2,"rank":2},
          {"id":"c","name":"Player C","seed":3,"rank":3},{"id":"d","name":"Player D","seed":4,"rank":5},
          {"id":"e","name":"Player E","seed":5,"rank":7},{"id":"f","name":"Player F","seed":6,"rank":10}]',
        '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"f"}},
          {"match_no":2,"round":"QF","p1":{"type":"player","id":"d"},"p2":{"type":"player","id":"e"}},
          {"match_no":3,"round":"SF","p1":{"type":"player","id":"a"},"p2":{"type":"winner","match":1}},
          {"match_no":4,"round":"SF","p1":{"type":"player","id":"b"},"p2":{"type":"winner","match":2}},
          {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
          {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]')`);
      await tx`select t.as_owner()`;
      await tx`select t.new_user(n) from generate_series(1, 60) n`;
      await tx.unsafe(TIMED_PICK);
    });
  }, 120_000);
  afterAll(async () => {
    await sql?.close().catch(() => {});
    await dropAuditDb(NAME);
  }, 60_000);

  test("50 calls spread −400…+400 ms around the lock: 40 fans once + 1 fan 10 times", async () => {
    const lock = await resetRound(1, 1500);
    const calls: Call[] = [];
    for (let i = 0; i < 40; i++)
      calls.push({ user: i + 1, target: -400 + i * 20, winner: "c", scores: score(i) });
    for (let j = 0; j < 10; j++)
      calls.push({ user: 41, target: -100 + j * 20, winner: "c", scores: score(10 + j) });
    await fire(calls, 1, lock);
    const v = verdict(calls, lock);
    const rows = await storedPicks(1);
    const accUsers = new Set(calls.filter((c) => c.ok).map((c) => uid(c.user)));
    const rowUsers = new Set(rows.map((r) => r.u));
    const fan41 = rows.filter((r) => r.u === uid(41));
    const fan41Accepted = calls
      .filter((c) => c.user === 41 && c.ok)
      .map((c) => JSON.stringify(JSON.parse(c.scores)));
    const [dups] =
      await sql`select count(*)::int as n from (select user_id from picks where match_no = 1
                                                                group by user_id having count(*) > 1) x`;
    const [days] =
      await sql`select count(*)::int as n, count(distinct user_id)::int as d from activity_days`;
    console.log(
      "N2 spread",
      JSON.stringify({ ...v, rows: rows.length, fan41Rows: fan41.length, activity: days }),
    );
    expect(v.otherErrors).toEqual([]);
    expect(v.acceptedAfterLock).toBe(0);
    expect(v.rejectedBeforeLock).toBe(0);
    expect(v.accepted).toBeGreaterThan(0);
    expect(v.locked).toBeGreaterThan(0);
    expect(rowUsers).toEqual(accUsers); // nothing accepted is lost, nothing rejected is stored
    expect(dups.n).toBe(0);
    expect(fan41.length).toBeLessThanOrEqual(1);
    if (fan41.length === 1) {
      const stored = fan41[0]!.s.replace(/\s/g, "");
      expect(fan41Accepted.map((s) => s.replace(/\s/g, ""))).toContain(stored);
    }
    expect(rows.every((r) => Number(r.at) < lock)).toBe(true);
    expect(days.n).toBe(days.d);
    expect(days.d).toBe(accUsers.size);
  }, 60_000);

  test("50 calls in one burst across the lock instant (−50 … +48 ms, 2 ms apart)", async () => {
    const lock = await resetRound(1, 1500);
    const calls: Call[] = Array.from({ length: 50 }, (_, i) => ({
      user: (i % 45) + 1, // users 1..5 call twice
      target: -50 + i * 2,
      winner: "c",
      scores: score(i),
    }));
    await fire(calls, 1, lock);
    const v = verdict(calls, lock);
    const rows = await storedPicks(1);
    const accUsers = new Set(calls.filter((c) => c.ok).map((c) => uid(c.user)));
    console.log("N2 burst", JSON.stringify({ ...v, rows: rows.length }));
    expect(v.otherErrors).toEqual([]);
    expect(v.acceptedAfterLock).toBe(0);
    expect(v.rejectedBeforeLock).toBe(0);
    expect(new Set(rows.map((r) => r.u))).toEqual(accUsers);
    expect(rows.every((r) => Number(r.at) < lock)).toBe(true);
  }, 60_000);

  // lock_match_now / set_match_start lock the match row FOR UPDATE and change starts_at; save_pick reads
  // the match with a plain SELECT (0005:66), so while the operator's transaction is open a fan's save
  // reads the OLD start and is accepted, stamped after the NEW start, and nothing voids it later
  // (0018 voids by the provider's real start, not by starts_at).
  test("N3 race (fixed by 0045): a save during an uncommitted lock_match_now waits and is refused", async () => {
    await resetRound(2, 60_000);
    const op = await sql.reserve();
    let lockAt = 0;
    const late: Call = { user: 50, target: 0, winner: "d", scores: score(3) };
    try {
      await op`begin`;
      await op`select t.as_service()`;
      await op`select lock_match_now(2)`;
      lockAt = Number((await op`select extract(epoch from now()) * 1000 as ms`)[0].ms);
      await sleep(150);
      const pending = savePick(late, 2); // a new pick: its FK check waits for the row lock
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const [m] =
      await sql`select extract(epoch from starts_at) * 1000 as ms from matches where match_no = 2`;
    const rows = await storedPicks(2);
    console.log(
      "N3 race lock_match_now",
      JSON.stringify({
        lockAt: new Date(lockAt).toISOString(),
        saveTxNowAfterLockMs: Math.round(late.txNow! - lockAt),
        accepted: late.ok,
        err: late.err,
        stored: rows.length,
        storedAfterStartMs: rows[0] ? Math.round(Number(rows[0].at) - Number(m.ms)) : null,
      }),
    );
    expect(Math.abs(Number(m.ms) - lockAt)).toBeLessThan(1);
    expect(late.txNow!).toBeGreaterThan(lockAt);
    expect(late.ok).toBe(false); // expected 'locked'; today: accepted
    expect(rows.filter((r) => Number(r.at) >= Number(m.ms))).toEqual([]);
  }, 60_000);

  test("N3 race (fixed by 0045): a pick changed during an uncommitted set_match_start (earlier) waits and is refused", async () => {
    await resetRound(2, 60_000);
    const first: Call = { user: 51, target: 0, winner: "d", scores: score(1) };
    await savePick(first, 2);
    expect(first.ok).toBe(true);
    const op = await sql.reserve();
    const change: Call = {
      user: 51,
      target: 0,
      winner: "e",
      scores: '[{"p1_games":4,"p2_games":6},{"p1_games":4,"p2_games":6}]',
    };
    let newStart = 0;
    try {
      await op`begin`;
      await op`select t.as_service()`;
      await op`select set_match_start(2, now() + interval '200 milliseconds')`;
      newStart = Number(
        (
          await op`select extract(epoch from starts_at) * 1000 as ms from matches where match_no = 2`
        )[0].ms,
      );
      await sleep(Math.max(0, newStart - Date.now()) + 300); // past the new start (same host clock)
      const pending = savePick(change, 2); // an update of an existing pick: no FK check, does not wait today
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const rows = await storedPicks(2);
    console.log(
      "N3 race set_match_start",
      JSON.stringify({
        saveAfterNewStartMs: Math.round(change.txNow! - newStart),
        accepted: change.ok,
        stored: rows[0]?.w,
      }),
    );
    expect(change.txNow!).toBeGreaterThan(newStart);
    expect(change.ok).toBe(false); // expected 'locked'; today: accepted
    expect(rows[0]?.w).toBe("d");
  }, 60_000);
});
