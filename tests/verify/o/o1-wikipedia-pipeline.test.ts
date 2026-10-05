/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// O1: offline Wikipedia fixtures, end to end: the real adapter (fake MediaWiki API) → the real poller
// (pollOnce) → the real ingest_result / settlement on PGlite, with the real 2026 draw file and its
// provider_map. Night 1: QF1 Fritz v Zverev 16:30Z (19:30 Riyadh), QF2 de Minaur v Sinner 17:40Z.
//
// Tests whose name starts with "BUG" or "SMELL" demonstrate a defect and FAIL today (5 Oct 2026).
import { describe, expect, it } from "bun:test";
import {
  apiMissing,
  apiPage,
  baseSlots,
  finished,
  freshEvent,
  P,
  wikitext,
  type Slots,
} from "./lib";

const T = 60_000;
const qf1Final = (
  winnerTop = true,
  sets: [number, number][] = [
    [6, 3],
    [6, 4],
  ],
) => finished(baseSlots(), "RD1:3", "RD1:4", winnerTop, sets);

describe("O1 normal final", () => {
  it("QF1 Fritz d. Zverev 6-3 6-4: waits 10 minutes of identical readings, then settles", async () => {
    const ev = await freshEvent();
    ev.wiki.set(apiPage(wikitext(qf1Final())));
    const runs = await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:12:00Z");
    expect(runs[0]![1]).toBe("awaiting_stability");
    expect(runs.slice(0, 9).every((r) => r[1] === "awaiting_stability")).toBe(true);
    expect(runs.some((r) => r[1] === "settled")).toBe(true);
    expect(await ev.match(1)).toMatchObject({
      status: "completed",
      winner_id: "fritz",
      set_scores: [
        { p1_games: 6, p2_games: 3 },
        { p1_games: 6, p2_games: 4 },
      ],
    });
    // QF2 is in its window, on the page with no score: not final, never touched
    expect(runs.at(-1)![2]).toBe("not_final");
    expect((await ev.match(2)).status).toBe("scheduled");
    expect((await ev.health())!.ok).toBe(true);
    await ev.db.close();
  }, 60_000);
});

describe("O1 live partial score", () => {
  it("scores going in, set winners in bold, nobody's name in bold: never settles", async () => {
    const ev = await freshEvent();
    const s = baseSlots();
    s["RD1:3"] = { ...P.fritz, scores: ["'''6'''", "3"] };
    s["RD1:4"] = { ...P.zverev, scores: ["4", "2"] };
    ev.wiki.set(apiPage(wikitext(s)));
    const runs = await ev.everyMinute("2026-10-21T17:00:00Z", "2026-10-21T17:20:00Z");
    expect(runs.every((r) => r[1] === "not_final")).toBe(true);
    expect((await ev.match(1)).status).toBe("scheduled");
    await ev.db.close();
  }, 60_000);

  it("an editor bolds the leader after one set: refused (not a legal finished match) and alerted, never settled", async () => {
    const ev = await freshEvent();
    const s = baseSlots();
    s["RD1:3"] = { ...P.fritz, bold: true, scores: ["'''6'''", "3"] };
    s["RD1:4"] = { ...P.zverev, scores: ["4", "2"] };
    ev.wiki.set(apiPage(wikitext(s)));
    const runs = await ev.everyMinute("2026-10-21T17:00:00Z", "2026-10-21T17:15:00Z");
    expect(runs.every((r) => r[1] === "rejected_invalid")).toBe(true);
    expect((await ev.match(1)).status).toBe("scheduled");
    expect((await ev.alerts("result_rejected")).length).toBe(1);
    await ev.db.close();
  }, 60_000);
});

describe("O1 retirement mid-set", () => {
  it("Zverev retires at 4-6 1-2 (<sup>r</sup>): settles as retired, sets as played", async () => {
    const ev = await freshEvent();
    const s = baseSlots();
    s["RD1:3"] = { ...P.fritz, bold: true, scores: ["'''6'''", "2"] };
    s["RD1:4"] = { ...P.zverev, scores: ["4", "1<sup>r</sup>"] };
    ev.wiki.set(apiPage(wikitext(s)));
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:12:00Z");
    expect(await ev.match(1)).toMatchObject({
      status: "retired",
      winner_id: "fritz",
      set_scores: [
        { p1_games: 6, p2_games: 4 },
        { p1_games: 2, p2_games: 1 },
      ],
    });
    await ev.db.close();
  }, 60_000);

  it("retirement written next to the name instead of the score: refused + alerted (fail safe), never settled", async () => {
    const ev = await freshEvent();
    const s = baseSlots();
    s["RD1:3"] = { ...P.fritz, bold: true, scores: ["'''6'''", "2"] };
    s["RD1:4"] = { ...P.zverev, raw: "[[Alexander Zverev]] (retired)", scores: ["4", "1"] };
    ev.wiki.set(apiPage(wikitext(s)));
    const runs = await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:12:00Z");
    expect(runs.every((r) => r[1] === "rejected_invalid")).toBe(true);
    expect((await ev.match(1)).status).toBe("scheduled");
    expect((await ev.alerts("result_rejected")).length).toBeGreaterThan(0);
    await ev.db.close();
  }, 60_000);
});

describe("O1 walkover", () => {
  it("w/o announced before the start: refused + started_before_schedule alert; after the start it settles as a walkover", async () => {
    const ev = await freshEvent();
    const s = baseSlots();
    s["RD1:3"] = { ...P.fritz, bold: true, scores: ["w/o"] };
    s["RD1:4"] = { ...P.zverev };
    ev.wiki.set(apiPage(wikitext(s)));
    await ev.at("2026-10-21T16:00:00Z");
    expect((await ev.poll())[1]).toBe("rejected_invalid");
    expect((await ev.alerts("started_before_schedule")).length).toBe(1);
    await ev.everyMinute("2026-10-21T16:30:00Z", "2026-10-21T16:42:00Z");
    expect(await ev.match(1)).toMatchObject({
      status: "walkover",
      winner_id: "fritz",
      set_scores: [],
    });
    await ev.db.close();
  }, 60_000);
});

describe("O1 vandal edit reverted inside stable_minutes", () => {
  it("before settlement: Zverev shown as winner 18:03–18:07, reverted 18:08: never settles on the vandal's result", async () => {
    const ev = await freshEvent();
    const real = apiPage(
      wikitext(
        qf1Final(true, [
          [6, 3],
          [6, 4],
        ]),
      ),
    );
    const vandal = apiPage(
      wikitext(
        qf1Final(false, [
          [3, 6],
          [4, 6],
        ]),
      ),
      1400000001,
    );
    const seen: (string | null)[] = [];
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:25:00Z", (t) => {
      const m = t.getUTCMinutes();
      ev.wiki.set(m >= 3 && m <= 7 ? vandal : real);
    });
    // replay the per-minute winner from the log of settlements
    const settled = (
      await ev.db.query<{ outcome: string; w: string }>(
        "select outcome, canonical->>'winner' as w from public.result_log where match_no = 1 and outcome in ('settled','resettled') order by id",
      )
    ).rows;
    seen.push(...settled.map((r) => r.w));
    expect(seen).toEqual(["fritz"]);
    expect((await ev.match(1)).winner_id).toBe("fritz");
    await ev.db.close();
  }, 60_000);

  it("after settlement: a 5-minute vandal flip is alerted at once and never re-settles", async () => {
    const ev = await freshEvent();
    const real = apiPage(wikitext(qf1Final(true)));
    const vandal = apiPage(
      wikitext(
        qf1Final(false, [
          [3, 6],
          [4, 6],
        ]),
      ),
      1400000001,
    );
    ev.wiki.set(real);
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:11:00Z");
    expect((await ev.match(1)).winner_id).toBe("fritz");
    await ev.everyMinute("2026-10-21T18:20:00Z", "2026-10-21T18:40:00Z", (t) => {
      const m = t.getUTCMinutes();
      ev.wiki.set(m >= 25 && m <= 29 ? vandal : real);
    });
    expect((await ev.match(1)).winner_id).toBe("fritz");
    expect((await ev.alerts("result_change_pending")).length).toBe(1);
    expect((await ev.alerts("result_changed")).length).toBe(0);
    await ev.db.close();
  }, 60_000);

  it("SMELL S-11: a vandal flipping a settled result back and forth raises one result_change_pending per flip (unthrottled)", async () => {
    const ev = await freshEvent();
    const real = apiPage(wikitext(qf1Final(true)));
    const vandal = apiPage(
      wikitext(
        qf1Final(false, [
          [3, 6],
          [4, 6],
        ]),
      ),
      1400000001,
    );
    ev.wiki.set(real);
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:11:00Z");
    await ev.everyMinute("2026-10-21T18:20:00Z", "2026-10-21T18:39:00Z", (t) => {
      ev.wiki.set(t.getUTCMinutes() % 2 === 0 ? vandal : real);
    });
    // every other alert kind is throttled to one per hour per match; this one is not
    expect((await ev.alerts("result_change_pending")).length).toBeLessThanOrEqual(1);
    await ev.db.close();
  }, 60_000);
});

describe("O1 player name spelled differently on the page (QF2 de Minaur v Sinner, Sinner wins)", () => {
  const qf2 = (name: string) => {
    const s: Slots = baseSlots();
    s["RD1:5"] = { ...P.deminaur, raw: name };
    return apiPage(
      wikitext(
        finished(s, "RD1:5", "RD1:6", false, [
          [4, 6],
          [3, 6],
        ]),
      ),
    );
  };
  const run = async (name: string) => {
    const ev = await freshEvent();
    ev.wiki.set(qf2(name));
    const runs = await ev.everyMinute("2026-10-21T19:20:00Z", "2026-10-21T19:32:00Z");
    await ev.db.query("select public.watchdog_check()");
    const out = {
      m: await ev.match(2),
      outcomes: runs.map((r) => r[2]),
      alerts: await ev.alerts(),
      health: await ev.health(),
    };
    await ev.db.close();
    return out;
  };

  it("piped link [[Alex de Minaur|De Minaur]] and plain bold text settle", async () => {
    for (const name of ["[[Alex de Minaur|De Minaur]]", "Alex de Minaur"]) {
      const r = await run(name);
      expect(r.m).toMatchObject({ status: "completed", winner_id: "sinner" });
    }
  }, 60_000);

  it("a redirect title ([[Alex De Minaur]], [[Alex De Miñaur]]): refused and alerted, never settled on a guess (fail safe)", async () => {
    for (const name of ["[[Alex De Minaur]]", "[[Alex De Miñaur]]"]) {
      const r = await run(name);
      expect(r.m.status).toBe("scheduled");
      expect(r.outcomes.every((o) => o === "rejected_invalid")).toBe(true);
      expect(
        r.alerts.some(
          (a) => a.kind === "result_rejected" && String(a.detail.reason).includes("provider_map"),
        ),
      ).toBe(true);
    }
  }, 60_000);

  it("SMELL: MediaWiki-equivalent spellings of the same title ([[Alex_de_Minaur]], [[alex de Minaur]], a doubled space) are not normalised, so the match never settles", async () => {
    for (const name of ["[[Alex_de_Minaur]]", "[[alex de Minaur]]", "[[Alex  de Minaur]]"]) {
      const r = await run(name);
      expect({ name, status: r.m.status }).toEqual({ name, status: "completed" });
    }
  }, 60_000);

  it("Fixed by poll.ts: a name written with a template ({{sortname|Alex|de Minaur}}) reads as 'not started' for ever, and the poller reports healthy", async () => {
    const r = await run("{{sortname|Alex|de Minaur}}");
    expect(r.m.status).toBe("scheduled"); // fail safe on settlement …
    // … but the brief requires an alert, and the heartbeat says all is well
    expect({
      healthy: r.health!.ok,
      alerted: r.alerts.some((a) => a.kind === "poller_unhealthy"),
    }).toEqual({ healthy: false, alerted: true });
  }, 60_000);
});

// --------------------------------------------------------------------------------------------------------
// Transport and page failures, at 18:00 on night 1 (QF1 in progress, QF2 in its window).
// Fail safe = no settlement, an unhealthy heartbeat, and watchdog_check() raising poller_unhealthy.
// --------------------------------------------------------------------------------------------------------
const failSafe = async (
  answer: Parameters<Awaited<ReturnType<typeof freshEvent>>["wiki"]["set"]>[0],
) => {
  const ev = await freshEvent();
  ev.wiki.set(answer);
  await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:12:00Z");
  await ev.db.query("select public.watchdog_check()");
  const r = {
    settled: (await ev.match(1)).status !== "scheduled",
    healthy: (await ev.health())!.ok,
    alerted: (await ev.alerts("poller_unhealthy")).length > 0,
    detail: (await ev.health())!.detail,
  };
  await ev.db.close();
  return r;
};

describe("O1 HTTP and page failures", () => {
  for (const [name, answer] of [
    ["HTTP 429", () => new Response("Too many requests", { status: 429 })],
    ["HTTP 500", () => new Response("oops", { status: 500 })],
    ["malformed JSON", () => new Response('{"query": {"pages": [', { status: 200 })],
    [
      "MediaWiki maxlag error",
      () =>
        new Response(JSON.stringify({ error: { code: "maxlag", info: "Waiting for db" } }), {
          status: 200,
        }),
    ],
    ["page does not exist (night 1 if nobody creates it)", () => apiMissing()],
  ] as const) {
    it(`${name}: no settlement, unhealthy heartbeat, poller_unhealthy alert`, async () => {
      const r = await failSafe(answer);
      expect({ settled: r.settled, healthy: r.healthy, alerted: r.alerted }).toEqual({
        settled: false,
        healthy: false,
        alerted: true,
      });
    }, 60_000);
  }

  for (const [name, answer] of [
    ["an empty page (blanked by a vandal)", () => apiPage("")],
    [
      "a page that is a redirect (#REDIRECT [[2026 Six Kings Slam (tennis)]])",
      () => apiPage("#REDIRECT [[2026 Six Kings Slam (tennis)]]"),
    ],
    [
      "a page with prose but no results bracket yet",
      () =>
        apiPage(
          "The '''2026 Six Kings Slam''' is an exhibition tournament.\n== Draw ==\nTo be announced.",
        ),
    ],
    [
      "a bracket in another layout (all params of a slot on one line)",
      () => apiPage(wikitext(qf1Final()).replace(/\n\| RD1-(team|score)/g, " | RD1-$1")),
    ],
  ] as const) {
    it(`BUG (silent feed): ${name}: no settlement, but the poller reports healthy and nothing alerts`, async () => {
      const r = await failSafe(answer);
      expect(r.settled).toBe(false);
      expect({ healthy: r.healthy, alerted: r.alerted }).toEqual({ healthy: false, alerted: true });
    }, 60_000);
  }

  it("S-10 (fixed by 0043): a settled result that disappears from the page (blanked) raises an alert", async () => {
    const ev = await freshEvent();
    ev.wiki.set(apiPage(wikitext(qf1Final())));
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:11:00Z");
    expect((await ev.match(1)).status).toBe("completed");
    ev.wiki.set(apiPage(""));
    await ev.everyMinute("2026-10-21T18:12:00Z", "2026-10-21T18:20:00Z");
    await ev.db.query("select public.watchdog_check()");
    const health = await ev.health();
    const alerts = await ev.alerts();
    await ev.db.close();
    expect({
      healthy: health!.ok,
      alerted: alerts.some((a) => a.kind !== "result_rejected"),
    }).toEqual({ healthy: false, alerted: true });
  }, 60_000);

  it("SMELL S-08: a Wikipedia request that never answers hangs the whole poll run (no fetch timeout)", async () => {
    const ev = await freshEvent();
    ev.wiki.set(() => "hang");
    await ev.at("2026-10-21T18:00:00Z");
    const result = await Promise.race([
      ev.poll().then(() => "finished"),
      new Promise((r) => setTimeout(() => r("still hanging after 15 s"), 15_000)),
    ]);
    // fail safe on settlement (nothing written); the watchdog sees the stale heartbeat after 5 minutes
    expect(result).toBe("finished");
  }, 30_000);

  it("the stale heartbeat of a hung run is caught by the watchdog (fail safe after 5 minutes)", async () => {
    const ev = await freshEvent();
    await ev.at("2026-10-21T18:00:00Z");
    await ev.db.query(
      "insert into public.ops_health (key, ok, detail, at) values ('poll-results', true, 'x', clock_timestamp() - interval '6 minutes') on conflict (key) do update set ok = true, at = excluded.at",
    );
    await ev.db.query("select public.watchdog_check()");
    expect((await ev.alerts("poller_unhealthy")).length).toBe(1);
    await ev.db.close();
  }, 30_000);

  it("SMELL: one HTTP 429 in the middle of a stable run restarts the 10-minute clock (documents current behaviour)", async () => {
    const ev = await freshEvent();
    const good = apiPage(wikitext(qf1Final()));
    const runs = await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:22:00Z", (t) => {
      const m = t.getUTCMinutes();
      ev.wiki.set(m === 9 ? new Response("", { status: 429 }) : good);
    });
    const settledAt = runs.findIndex((r) => r[1] === "settled");
    // without the 429 it settles at minute 10; with it, only 10 minutes after minute 10
    expect(settledAt).toBeGreaterThanOrEqual(19);
    await ev.db.close();
  }, 60_000);

  it("F-05 re-check: an unmapped match makes the run unhealthy (fixed by 0016 / poll.ts)", async () => {
    const ev = await freshEvent();
    await ev.db.query(
      "delete from public.provider_map where provider = 'wikipedia' and kind = 'match' and our_ref = '2'",
    );
    ev.wiki.set(apiPage(wikitext(qf1Final())));
    await ev.at("2026-10-21T18:00:00Z");
    expect(await ev.poll()).toEqual({ 1: "awaiting_stability", 2: "no provider id mapped" });
    expect((await ev.health())!.ok).toBe(false);
    await ev.db.close();
  }, 30_000);

  it("S-07 re-check: one match whose adapter call throws does not stop the others (fixed: try/catch per match)", async () => {
    const ev = await freshEvent();
    ev.wiki.set(apiPage(wikitext(qf1Final())));
    await ev.at("2026-10-21T18:00:00Z");
    const { pollAsService } = await import("../../../scripts/lib/poller");
    const base = ev.wiki.adapter();
    const flaky = {
      provider: "wikipedia",
      fetchMatch: (ref: string, ctx: any) =>
        ref === "RD1:3-4" ? Promise.reject(new Error("boom")) : base.fetchMatch(ref, ctx),
    };
    const out = Object.fromEntries(
      (await pollAsService(ev.db, flaky)).map((o) => [o.match_no, o.outcome]),
    );
    expect(out).toEqual({ 1: "error", 2: "not_final" });
    expect((await ev.health())!.ok).toBe(false);
    await ev.db.close();
  }, 30_000);
});

describe("O1 pre-start junk read as 'live' voids honest picks (0018 real_start)", () => {
  it("BUG: '&nbsp;' left in QF1's score cells makes every reading from the window's opening 'live', so a pick saved 30 minutes BEFORE the scheduled start scores 0", async () => {
    const ev = await freshEvent();
    await ev.db.query("select t.new_user(1)");
    const placeholder = baseSlots();
    placeholder["RD1:3"] = { ...P.fritz, scores: ["&nbsp;", "&nbsp;"] };
    placeholder["RD1:4"] = { ...P.zverev, scores: ["&nbsp;", "&nbsp;"] };
    ev.wiki.set(apiPage(wikitext(placeholder)));
    await ev.everyMinute("2026-10-21T15:30:00Z", "2026-10-21T15:40:00Z"); // window opens at start − 60 min
    await ev.at("2026-10-21T16:00:00Z");
    expect(
      await ev.db
        .query<{ e: string | null }>("select t.pick(t.uid(1), 1, 'fritz', '6-3 6-4') as e")
        .then((r) => r.rows[0]!.e),
    ).toBeNull();
    ev.wiki.set(apiPage(wikitext(qf1Final())));
    await ev.everyMinute("2026-10-21T18:00:00Z", "2026-10-21T18:12:00Z");
    expect((await ev.match(1)).status).toBe("completed");
    const started = (
      await ev.db.query<{ s: string }>(
        "select started_at::text as s from public.matches where match_no = 1",
      )
    ).rows[0]!.s;
    const pts = (await ev.db.query<{ p: string }>("select t.pts(t.uid(1), 1) as p")).rows[0]!.p;
    await ev.db.close();
    // the pick was saved at 16:00, before the 16:30 start, and is exactly right
    expect({
      started_before_scheduled_start: Date.parse(started) < Date.parse("2026-10-21T16:30:00Z"),
      pts,
    }).toEqual({
      started_before_scheduled_start: false,
      pts: expect.not.stringMatching(/^0\/0\/0\/0$/),
    });
  }, 60_000);
});

void T;
