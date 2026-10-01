// Provider adapters translate only. These tests use invented payloads in each provider's documented
// shape; Phase 3 adds recorded real payloads as fixtures.
import { describe, expect, it } from "bun:test";
import { normaliseSportradar, SportradarAdapter, type SrSummary } from "../supabase/functions/poll-results/adapters/sportradar.ts";
import { FixtureAdapter, type FixtureFile } from "../supabase/functions/poll-results/adapters/fixture.ts";
import fixtureEvent from "../supabase/functions/poll-results/fixtures/event.json";

const summary = (status: string, matchStatus: string, sets: [number, number][], extra: Partial<SrSummary> = {}): SrSummary => ({
  sport_event: {
    id: "sr:sport_event:1",
    start_time: "2026-10-21T16:30:00+00:00",
    competitors: [
      { id: "sr:competitor:2", qualifier: "away" },
      { id: "sr:competitor:1", qualifier: "home" },
    ],
  },
  sport_event_status: {
    status,
    match_status: matchStatus,
    winner_id: "sr:competitor:1",
    // deliberately out of order, with a tiebreak point count on set 1
    period_scores: sets
      .map(([h, a], i) => ({ home_score: h, away_score: a, type: "set", number: i + 1 }))
      .reverse(),
  },
  ...extra,
});

describe("Sportradar adapter", () => {
  it("maps a closed match to completed, home first, sets in order", () => {
    const n = normaliseSportradar("sr:sport_event:1", summary("closed", "ended", [[7, 6], [3, 6], [6, 4]]));
    expect(n.status).toBe("completed");
    expect(n.players).toEqual(["sr:competitor:1", "sr:competitor:2"]);
    expect(n.winner).toBe("sr:competitor:1");
    expect(n.set_scores).toEqual([
      { p1_games: 7, p2_games: 6 },
      { p1_games: 3, p2_games: 6 },
      { p1_games: 6, p2_games: 4 },
    ]);
    expect(n.scheduled_at).toBe("2026-10-21T16:30:00+00:00");
  });

  it("does not treat 'ended' (not yet confirmed) as final", () => {
    expect(normaliseSportradar("x", summary("ended", "ended", [[6, 4], [6, 4]])).status).toBe("live");
  });

  it("maps retirements, defaults and walkovers", () => {
    expect(normaliseSportradar("x", summary("closed", "retired", [[6, 4], [2, 1]])).status).toBe("retired");
    expect(normaliseSportradar("x", summary("closed", "defaulted", [[6, 4]])).status).toBe("retired");
    expect(normaliseSportradar("x", summary("closed", "walkover", [])).status).toBe("walkover");
  });

  it("maps not started and unknown statuses without inventing a result", () => {
    expect(normaliseSportradar("x", summary("not_started", "not_started", [])).status).toBe("scheduled");
    expect(normaliseSportradar("x", summary("cancelled", "cancelled", [])).status).toBe("unknown");
  });

  it("keeps the raw body and HTTP status, and sends the key as a header", async () => {
    let seen: { url: string; key: string | null } = { url: "", key: null };
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen = { url, key: new Headers(init?.headers).get("x-api-key") };
      return new Response(JSON.stringify(summary("closed", "ended", [[6, 4], [6, 4]])), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new SportradarAdapter("test-key", "trial", fakeFetch).fetchMatch("sr:sport_event:1");
    expect(seen.url).toContain("/tennis/trial/v3/en/sport_events/sr%3Asport_event%3A1/summary.json");
    expect(seen.key).toBe("test-key");
    expect(r.http_status).toBe(200);
    expect(r.normalised.status).toBe("completed");
    expect(r.raw).toHaveProperty("sport_event_status");
  });

  it("an HTTP error becomes an unknown status, never a result", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const r = await new SportradarAdapter("k", "trial", fakeFetch).fetchMatch("m");
    expect(r.http_status).toBe(429);
    expect(r.normalised.status).toBe("unknown");
    expect(r.normalised.set_scores).toEqual([]);
  });
});

describe("Fixture adapter", () => {
  it("returns the fixture payload for a known match", async () => {
    const r = await new FixtureAdapter(fixtureEvent as FixtureFile).fetchMatch("fx-m1");
    expect(r.http_status).toBe(200);
    expect(r.normalised.winner).toBe("fx-f");
  });
  it("answers 404 for an unknown match", async () => {
    const r = await new FixtureAdapter(fixtureEvent as FixtureFile).fetchMatch("nope");
    expect(r.http_status).toBe(404);
    expect(r.normalised.status).toBe("unknown");
  });
});
