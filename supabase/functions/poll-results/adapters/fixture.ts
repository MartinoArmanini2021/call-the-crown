// LOCAL ONLY — replays recorded-looking payloads from fixtures/*.json, so the whole pipeline (poller →
// ingest_result → settlement) runs without a provider account. The payloads are invented.
// A fixture file maps a match ref to the payload the provider would return "now"; the replay script
// (scripts/replay-fixture.ts) feeds them in order.
import type { FetchedResult, NormalisedResult, ResultsAdapter } from "./types.ts";

export type FixtureFile = Record<string, NormalisedResult>;

export class FixtureAdapter implements ResultsAdapter {
  readonly provider = "fixture";
  constructor(private readonly payloads: FixtureFile) {}

  async fetchMatch(matchRef: string): Promise<FetchedResult> {
    const payload = this.payloads[matchRef];
    if (!payload) {
      return {
        http_status: 404,
        raw: { error: "not in fixture" },
        normalised: { match_ref: matchRef, status: "unknown", players: [], winner: null, set_scores: [] },
      };
    }
    return { http_status: 200, raw: { fixture: payload }, normalised: payload };
  }
}
