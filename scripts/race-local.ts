// save_pick under real concurrency, on the local `supabase start` Postgres server (PGlite has one
// connection, so the SQL tests cannot race). Runs in a private throwaway database (scripts/lib/
// scratch-db.ts), created and dropped here; the local `postgres` database and its clock are untouched.
// Every step asserts what it claims; exit 1 on the first failure.
//   bun scripts/race-local.ts                     (RACE_KEEP_GOING=1: run every claim, report all)
//
// The races (audit 5-6 Oct 2026, finding N2/N3, fixed by 0045): an operator's transaction holds the
// match row (lock_match_now, set_match_start, a corrected result refilling the bracket) while a fan saves
// a pick. save_pick must wait for it and judge the pick on the committed row: no pick stamped after the
// new start, and no pick on a player the correction removed.
import type { SQL } from "bun";
import { createScratchDb, dropScratchDb, serverUp } from "./lib/scratch-db";

const NAME = `scratch_race_${process.pid}`;
const POOL = 30; // the local server allows 100 connections and the stack itself holds ~50

let step = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: unknown): void {
  step++;
  console.log(
    `${ok ? "  ✓" : "  ✗"} ${text}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ""}`,
  );
  if (!ok) {
    failures++;
    if (!process.env["RACE_KEEP_GOING"]) throw new Error("claim failed");
  }
}

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const twoSets = (a: number, b: number, c: number, d: number) =>
  JSON.stringify([
    { p1_games: a, p2_games: b },
    { p1_games: c, p2_games: d },
  ]);

// One round trip and one transaction per call, like a PostgREST RPC: sets the fan's JWT claims and
// role, calls save_pick, and returns the transaction's now() (what save_pick compares) and the outcome.
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

type Call = {
  user: number;
  winner: string;
  scores: string;
  at?: number;
  txNow?: number;
  err?: string | null;
};

let sql!: SQL; // set by createScratchDb; finally may run before it is (then close() is skipped)

async function save(c: Call, match: number): Promise<void> {
  try {
    const [r] =
      await sql`select tx_ms, err from t.timed_pick(${uid(c.user)}::uuid, ${match}, ${c.winner}, ${c.scores}::text::jsonb)`;
    c.txNow = Number(r.tx_ms);
    c.err = r.err as string | null;
  } catch (e) {
    c.err = (e as Error).message;
  }
}

async function asService(q: string) {
  await sql.begin(async (tx) => {
    await tx`select t.as_service()`;
    await tx.unsafe(q);
  });
}

const picksOn = async (match: number) =>
  (await sql`select user_id::text as u, winner_id as w, extract(epoch from updated_at) * 1000 as at
               from picks where match_no = ${match}`) as { u: string; w: string; at: string }[];
const startOf = async (match: number) =>
  Number(
    (
      await sql`select extract(epoch from starts_at) * 1000 as ms from matches where match_no = ${match}`
    )[0].ms,
  );

/** No picks, every match tomorrow except match `m`, which starts `leadMs` from now on a whole second. */
async function freshRound(m: number, leadMs: number): Promise<number> {
  await sql.unsafe(`delete from picks; delete from activity_days;
    update matches set starts_at = now() + interval '1 day' where status = 'scheduled';`);
  const [r] = await sql.unsafe(
    `select extract(epoch from date_trunc('second', clock_timestamp() + interval '${leadMs} milliseconds') + interval '1 second') * 1000 as ms`,
  );
  const lock = Number(r.ms);
  await asService(`select set_match_start(${m}, to_timestamp(${lock / 1000}))`);
  return lock;
}

if (!(await serverUp())) {
  console.error(
    "The local Supabase Postgres (127.0.0.1:55322) is not running: `bunx supabase start`.",
  );
  process.exit(1);
}

try {
  console.log(`\nA private database ${NAME} with every migration`);
  sql = await createScratchDb(NAME, POOL);
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
    // the fixture provider's ids, as t.setup_event maps them (t.feed sends results under them)
    await tx.unsafe(`insert into provider_map (provider, kind, provider_ref, our_ref)
      select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 6) n
      union all
      select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f']) p
      on conflict do nothing`);
    await tx`select t.as_owner()`;
    await tx`select t.new_user(n) from generate_series(1, 60) n`;
    await tx.unsafe(TIMED_PICK);
  });
  claim(true, "six invented players, the bracket, 60 invented fans");

  // ---------------------------------------------------------------------------------------------------
  console.log("\n1. The operator locks a match now while a fan saves a new pick");
  {
    await freshRound(2, 60_000);
    const op = await sql.reserve();
    const fan: Call = { user: 50, winner: "d", scores: twoSets(6, 3, 6, 3) };
    let lockAt = 0;
    try {
      await op`begin`;
      await op`select t.as_service()`;
      await op`select lock_match_now(2)`;
      lockAt = Number((await op`select extract(epoch from now()) * 1000 as ms`)[0].ms);
      await sleep(150);
      const pending = save(fan, 2);
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const start = await startOf(2);
    const rows = await picksOn(2);
    claim(Math.abs(start - lockAt) < 1, "the match now starts at the operator's moment");
    claim(
      fan.txNow! > lockAt,
      "the fan's save began after the lock (inside the operator's transaction)",
    );
    claim(fan.err === "locked", "the save waits for the operator and is refused: locked", fan.err);
    claim(
      rows.every((r) => Number(r.at) < start),
      "no pick is stored at or after the new start",
      rows,
    );
  }

  // ---------------------------------------------------------------------------------------------------
  console.log("\n2. The operator moves a match earlier while a fan changes an existing pick");
  {
    await freshRound(2, 60_000);
    const first: Call = { user: 51, winner: "d", scores: twoSets(6, 1, 6, 1) };
    await save(first, 2);
    claim(first.err === null, "the fan's first pick is saved", first.err);
    const op = await sql.reserve();
    const change: Call = { user: 51, winner: "e", scores: twoSets(4, 6, 4, 6) };
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
      await sleep(newStart - Date.now() + 300); // past the new start (same host clock)
      const pending = save(change, 2);
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const rows = await picksOn(2);
    claim(change.txNow! > newStart, "the change was made after the new start");
    claim(
      change.err === "locked",
      "the change waits for the operator and is refused: locked",
      change.err,
    );
    claim(
      rows.length === 1 && rows[0]!.w === "d",
      "the pick made before the start stands unchanged",
      rows,
    );
  }

  // ---------------------------------------------------------------------------------------------------
  console.log(
    "\n3. A corrected quarter-final refills the semi-final while a fan picks the removed player",
  );
  {
    await sql.unsafe(`delete from picks; delete from activity_days;
      update matches set starts_at = now() + interval '1 day' where status = 'scheduled';
      update matches set starts_at = now() - interval '3 hours' where match_no = 1;`);
    const first = (await sql`select t.feed(1, 'completed', 'c', '6-4 6-3') ->> 'outcome' as o`)[0]
      .o;
    claim(first === "settled", "QF1 settles: C beats F", first);
    const p2 = (await sql`select p2_id from matches where match_no = 3`)[0].p2_id;
    claim(p2 === "c", "SF1 is A v C", p2);
    const op = await sql.reserve();
    const fan: Call = { user: 52, winner: "c", scores: twoSets(4, 6, 4, 6) };
    let outcome = "";
    try {
      await op`begin`;
      outcome = (await op`select t.feed(1, 'completed', 'f', '4-6 4-6') ->> 'outcome' as o`)[0].o;
      await sleep(150);
      const pending = save(fan, 3);
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const now = (await sql`select p2_id from matches where match_no = 3`)[0].p2_id;
    const onC = (await picksOn(3)).filter((r) => r.w === "c");
    claim(
      outcome === "resettled" && now === "f",
      "the correction re-settles QF1 and SF1 becomes A v F",
      {
        outcome,
        now,
      },
    );
    claim(
      fan.err === "winner_not_in_match",
      "the fan's pick on C waits for the correction and is refused: winner_not_in_match",
      fan.err,
    );
    claim(onC.length === 0, "no pick on the removed player survives", onC);
  }

  // ---------------------------------------------------------------------------------------------------
  console.log("\n4. Fifty fans at once across the lock second");
  {
    const lock = await freshRound(2, 1500);
    const calls: Call[] = Array.from({ length: 50 }, (_, i) => ({
      user: (i % 45) + 1, // fans 1–5 call twice
      winner: "d",
      scores: twoSets(6, i % 5, 6, (i + 2) % 5),
      at: -50 + i * 2,
    }));
    const before = Date.now();
    const [srv] = await sql`select extract(epoch from clock_timestamp()) * 1000 as ms`;
    const off = Number(srv.ms) - (before + Date.now()) / 2;
    await Promise.all(Array.from({ length: POOL }, () => sql`select pg_sleep(0.02)`)); // warm the pool
    await Promise.all(
      calls.map(async (c) => {
        await sleep(lock + c.at! - off - Date.now());
        await save(c, 2);
      }),
    );
    const other = calls.filter((c) => c.err && c.err !== "locked");
    const late = calls.filter((c) => c.err === null && c.txNow! >= lock);
    const early = calls.filter((c) => c.err === "locked" && c.txNow! < lock);
    const rows = await picksOn(2);
    const accepted = new Set(calls.filter((c) => c.err === null).map((c) => uid(c.user)));
    const [dups] =
      await sql`select count(*)::int as n from (select user_id from picks where match_no = 2 group by user_id having count(*) > 1) x`;
    claim(other.length === 0, "every call is either saved or refused as locked", other);
    claim(late.length === 0, "none accepted at or after the lock", late);
    claim(early.length === 0, "none refused before the lock", early);
    claim(
      rows.length === accepted.size && rows.every((r) => accepted.has(r.u)),
      `every accepted fan has exactly one pick (${accepted.size} of 45), nothing refused is stored`,
    );
    claim(dups.n === 0, "no duplicate rows");
    claim(
      rows.every((r) => Number(r.at) < lock),
      "every stored pick is older than the start",
    );
  }

  // ---------------------------------------------------------------------------------------------------
  console.log("\n5. An account is deleted while a new fan signs up (ranks exist)");
  {
    const ranked = Number(
      (await sql`select count(*) as n from standings where rank is not null`)[0].n,
    );
    claim(ranked > 0, `ranks exist (${ranked} ranked fans, from QF1's settlement)`);
    const op = await sql.reserve();
    let joined: unknown = null;
    try {
      await op`begin`;
      await op`delete from auth.users where id = ${uid(10)}::uuid`; // closes the gap, lock held
      await sleep(150);
      const pending = sql`select t.new_user(61)`.then(
        () => (joined = "ok"),
        (e: Error) => (joined = e.message),
      ); // rank_new_fan takes "the next place"
      await sleep(150);
      await op`commit`;
      await pending;
    } finally {
      op.release();
    }
    const [r] =
      await sql`select count(*)::int as n, max(rank) as max, count(distinct rank)::int as d,
                                  bool_and(rank = rn) as dense
                             from (select rank, row_number() over (order by rank) as rn
                                     from standings where rank is not null) x`;
    const [me] = await sql`select rank from standings where user_id = ${uid(61)}::uuid`;
    claim(joined === "ok", "the new fan's sign-up goes through", joined);
    claim(r.n === ranked && r.dense === true, "ranks stay 1..n with no gap or repeat", r);
    claim(
      Number(me?.rank) === r.n,
      "the new fan takes the last place, right after the deletion closed its gap",
      {
        newFan: me?.rank,
        ranked: r.n,
      },
    );
  }

  if (failures) throw new Error("claim failed");
  console.log(`\n${step} claims, all true, on the local Postgres server.`);
} catch (e) {
  if ((e as Error).message !== "claim failed") console.error(e);
  process.exitCode = 1;
} finally {
  await sql?.close().catch(() => {});
  await dropScratchDb(NAME);
}
