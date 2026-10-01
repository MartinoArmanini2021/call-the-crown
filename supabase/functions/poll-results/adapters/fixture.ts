// LOCAL ONLY — replays invented payloads from fixtures/*.json in time, like a real feed would:
// "scheduled" before the start, "live" during the match, the final payload once the match is
// `releaseAfterMinutes` old (90 by default). So the local walkthrough is driven by the simulated clock
// alone. The payloads are invented.
import type { FetchContext, FetchedResult, NormalisedResult, ResultsAdapter } from "./types.ts";

export type FixtureFile = Record<string, NormalisedResult>;

export class FixtureAdapter implements ResultsAdapter {
  readonly provider = "fixture";
  constructor(
    private readonly payloads: FixtureFile,
    private readonly releaseAfterMinutes = 90,
  ) {}

  async fetchMatch(matchRef: string, ctx: FetchContext): Promise<FetchedResult> {
    const payload = this.payloads[matchRef];
    if (!payload) {
      return {
        http_status: 404,
        raw: { error: "not in fixture" },
        normalised: { match_ref: matchRef, status: "unknown", players: [], winner: null, set_scores: [] },
      };
    }
    const start = ctx.startsAt ? Date.parse(ctx.startsAt) : Number.POSITIVE_INFINITY;
    const released = ctx.nowMs >= start + this.releaseAfterMinutes * 60_000;
    const normalised: NormalisedResult = released
      ? payload
      : {
          match_ref: matchRef,
          status: ctx.nowMs >= start ? "live" : "scheduled",
          players: payload.players,
          winner: null,
          set_scores: [],
        };
    return { http_status: 200, raw: { fixture: normalised }, normalised };
  }
}
