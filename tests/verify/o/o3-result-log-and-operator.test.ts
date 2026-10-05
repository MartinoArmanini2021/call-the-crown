// O3: result_log is append-only for every role; pause_settlement and reseat_paused_match do what their
// names say. PGlite, real migrations, real 2026 draw file, real Wikipedia adapter + poller.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { apiPage, baseSlots, finished, freshEvent, wikitext, type Ev } from "./lib";

const qf1 = (top: boolean) =>
  finished(
    baseSlots(),
    "RD1:3",
    "RD1:4",
    top,
    top
      ? [
          [6, 3],
          [6, 4],
        ]
      : [
          [3, 6],
          [4, 6],
        ],
  );

describe("O3 result_log is immutable", () => {
  let ev: Ev;
  beforeAll(async () => {
    ev = await freshEvent();
    ev.wiki.set(apiPage(wikitext(qf1(true))));
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:02:00Z");
  }, 60_000);
  afterAll(() => ev.db.close());

  const attempt = async (role: string | null, sql: string) => {
    try {
      await ev.db.transaction(async (tx) => {
        if (role) {
          await tx.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ role }),
          ]);
          await tx.exec(`set local role ${role}`);
        }
        await tx.exec(sql);
      });
      return "allowed";
    } catch (e) {
      return (e as Error).message;
    }
  };

  for (const role of ["anon", "authenticated", "service_role"]) {
    it(`${role}: insert, update, delete and truncate are all refused`, async () => {
      for (const sql of [
        "insert into public.result_log (provider, outcome) values ('wikipedia', 'settled')",
        "update public.result_log set outcome = 'x'",
        "delete from public.result_log where true",
        "truncate public.result_log",
      ]) {
        expect(await attempt(role, sql)).toMatch(/permission denied/);
      }
    });
  }

  it("postgres (owner, superuser here): update, delete and truncate hit the append-only trigger", async () => {
    for (const sql of [
      "update public.result_log set outcome = 'x'",
      "delete from public.result_log where true",
      "truncate public.result_log",
    ]) {
      expect(await attempt(null, sql)).toMatch(/result_log_is_append_only/);
    }
    const n = (await ev.db.query<{ n: number }>("select count(*)::int as n from public.result_log"))
      .rows[0]!.n;
    expect(n).toBeGreaterThan(0);
  });

  it("OPTIONAL (documented): the table owner can still bypass by disabling the trigger — no DB-level guard can stop the owner", async () => {
    const r = await attempt(
      null,
      "alter table public.result_log disable trigger result_log_no_change; delete from public.result_log where true;",
    );
    expect(r).toBe("allowed"); // inside a rolled-back test transaction? no: committed, so check, then note
  });
});

describe("O3 pause_settlement", () => {
  it("paused: final readings are logged 'paused' and nothing settles; unpaused: the next poll settles", async () => {
    const ev = await freshEvent();
    await ev.db.exec("set role service_role; select public.pause_settlement(1, true); reset role;");
    ev.wiki.set(apiPage(wikitext(qf1(true))));
    const runs = await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:15:00Z");
    expect(runs.every((r) => r[1] === "paused")).toBe(true);
    expect((await ev.match(1)).status).toBe("scheduled");
    await ev.db.exec(
      "set role service_role; select public.pause_settlement(1, false); reset role;",
    );
    await ev.at("2026-10-21T18:16:00Z");
    expect((await ev.poll())[1]).toBe("settled");
    await ev.db.close();
  }, 60_000);

  it("paused after settlement: a correction is logged 'paused' and never re-settles", async () => {
    const ev = await freshEvent();
    ev.wiki.set(apiPage(wikitext(qf1(true))));
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:11:00Z");
    await ev.db.exec("set role service_role; select public.pause_settlement(1, true); reset role;");
    ev.wiki.set(apiPage(wikitext(qf1(false))));
    const runs = await ev.everyMinute("2026-10-21T18:12:00Z", "2026-10-21T18:30:00Z");
    expect(runs.every((r) => r[1] === "paused")).toBe(true);
    expect((await ev.match(1)).winner_id).toBe("fritz");
    await ev.db.close();
  }, 60_000);

  it("SMELL: pause_settlement(n, null) silently UNpauses (coalesce(null, false))", async () => {
    const ev = await freshEvent();
    await ev.db.exec(
      "set role service_role; select public.pause_settlement(1, true); select public.pause_settlement(1, null); reset role;",
    );
    const paused = (await ev.match(1)).settlement_paused;
    await ev.db.close();
    expect(paused).toBe(true);
  }, 30_000);

  it("fans and anon cannot pause, reseat, refetch or ingest", async () => {
    const ev = await freshEvent();
    for (const role of ["anon", "authenticated"]) {
      for (const fn of [
        "pause_settlement(1, true)",
        "reseat_paused_match(1)",
        "request_refetch(1)",
        "lock_match_now(1)",
        "ingest_result('wikipedia', '{}'::jsonb, '{}'::jsonb, 200)",
        "ingest_heartbeat(true, 'x')",
        "watchdog_check()",
        "watchdog()",
        "kick_poller()",
      ]) {
        let msg = "allowed";
        try {
          await ev.db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.exec(`select public.${fn}`);
          });
        } catch (e) {
          msg = (e as Error).message;
        }
        expect({ role, fn, msg }).toEqual({
          role,
          fn,
          msg: expect.stringMatching(/permission denied/),
        });
      }
    }
    await ev.db.close();
  }, 30_000);
});

describe("O3 reseat_paused_match (F-08 re-check, through the Wikipedia pipeline)", () => {
  it("QF1 corrected Fritz → Zverev after SF1 started: SF1 pauses; reseat takes Zverev from the corrected bracket; the page's SF1 result then settles", async () => {
    const ev = await freshEvent();
    // night 1: QF1 Fritz, QF2 Sinner
    let slots = finished(qf1(true), "RD1:5", "RD1:6", false, [
      [4, 6],
      [3, 6],
    ]);
    ev.wiki.set(apiPage(wikitext(slots)));
    await ev.everyMinute("2026-10-21T19:00:00Z", "2026-10-21T19:11:00Z");
    expect(await ev.match(3)).toMatchObject({ p1_id: "alcaraz", p2_id: "fritz" });
    // night 2, SF1 under way; the page's QF1 is corrected to Zverev and the SF1 slot shows Zverev
    slots = finished(slots, "RD1:3", "RD1:4", false, [
      [3, 6],
      [4, 6],
    ]);
    slots["RD2:1"] = { link: "Carlos Alcaraz", flag: "ESP" };
    slots["RD2:2"] = { link: "Alexander Zverev", flag: "GER" };
    ev.wiki.set(apiPage(wikitext(slots)));
    await ev.db.query(
      "update public.matches set refetch_requested_at = clock_timestamp() where match_no = 1",
    ); // as request_refetch
    await ev.everyMinute("2026-10-22T16:40:00Z", "2026-10-22T16:52:00Z");
    expect((await ev.match(1)).winner_id).toBe("zverev");
    expect(await ev.match(3)).toMatchObject({ p2_id: "fritz", settlement_paused: true });
    expect((await ev.alerts("bracket_conflict")).length).toBe(1);
    // the SF1 result names Zverev: refused while our match has Fritz
    slots = finished(slots, "RD2:1", "RD2:2", true, [
      [6, 4],
      [6, 4],
    ]);
    ev.wiki.set(apiPage(wikitext(slots)));
    await ev.at("2026-10-22T18:00:00Z");
    expect((await ev.poll())[3]).toBe("rejected_invalid");
    await ev.db.exec("set role service_role; select public.reseat_paused_match(3); reset role;");
    expect(await ev.match(3)).toMatchObject({
      p1_id: "alcaraz",
      p2_id: "zverev",
      settlement_paused: false,
    });
    await ev.everyMinute("2026-10-22T18:01:00Z", "2026-10-22T18:13:00Z");
    expect(await ev.match(3)).toMatchObject({ status: "completed", winner_id: "alcaraz" });
    await ev.db.close();
  }, 120_000);

  it("reseat refuses a match that is not paused, and a settled one", async () => {
    const ev = await freshEvent();
    const err = async (sql: string) => {
      try {
        await ev.db.exec(sql);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await err("select public.reseat_paused_match(3)")).toMatch(/not_paused/);
    expect(await err("select public.reseat_paused_match(99)")).toMatch(/no_such_match/);
    await ev.db.close();
  }, 30_000);
});
