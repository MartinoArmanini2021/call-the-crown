// Sportradar Tennis API v3 — the recommended primary source (plan, section c). Sportradar lists the
// event as competition "Riyadh Exhibition" (sr:competition:44567), with seasons for 2024, 2025 and 2026.
//
// NOT YET RUN AGAINST REAL DATA. Written from Sportradar's public documentation of the match summary
// (GET /tennis/{access_level}/v3/{language}/sport_events/{id}/summary.json, header x-api-key).
// Phase 3 checks it against the 2024/2025 editions under a trial key and records real payloads as
// fixtures. Until then treat the field names below as the documented shape, not a verified one.
import type { FetchedResult, NormalisedResult, ResultStatus, ResultsAdapter } from "./types.ts";

type SrCompetitor = { id: string; qualifier?: "home" | "away" };
type SrPeriodScore = { home_score?: number; away_score?: number; type?: string; number?: number };
export type SrSummary = {
  sport_event?: { id?: string; start_time?: string; competitors?: SrCompetitor[] };
  sport_event_status?: {
    status?: string;          // not_started, live, ended, closed, cancelled, postponed, ...
    match_status?: string;    // ended, retired, walkover, defaulted, ...
    winner_id?: string;
    period_scores?: SrPeriodScore[];
  };
};

// Sportradar's "closed" = results confirmed; "ended" = play over, not yet confirmed. We settle on
// "closed" only (plan, open question 8): a few minutes later, much less likely to be corrected.
function mapStatus(s: SrSummary["sport_event_status"]): ResultStatus {
  const status = s?.status ?? "";
  const match = s?.match_status ?? "";
  if (status === "not_started") return "scheduled";
  if (status === "live" || status === "ended") return "live";
  if (status === "closed") {
    if (match === "retired" || match === "defaulted") return "retired";
    if (match === "walkover") return "walkover";
    return "completed";
  }
  return "unknown";
}

export function normaliseSportradar(matchRef: string, body: SrSummary): NormalisedResult {
  const competitors = body.sport_event?.competitors ?? [];
  const home = competitors.find((c) => c.qualifier === "home") ?? competitors[0];
  const away = competitors.find((c) => c.qualifier === "away") ?? competitors[1];
  const status = mapStatus(body.sport_event_status);
  const sets = (body.sport_event_status?.period_scores ?? [])
    .filter((p) => (p.type ?? "set") === "set")
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((p) => ({ p1_games: p.home_score as number, p2_games: p.away_score as number }));
  return {
    match_ref: matchRef,
    status,
    players: home && away ? [home.id, away.id] : [],
    winner: body.sport_event_status?.winner_id ?? null,
    set_scores: sets,
    scheduled_at: body.sport_event?.start_time ?? null,
  };
}

export class SportradarAdapter implements ResultsAdapter {
  readonly provider = "sportradar";
  constructor(
    private readonly apiKey: string,
    private readonly accessLevel: "trial" | "production" = "production",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async fetchMatch(matchRef: string): Promise<FetchedResult> {
    const url = `https://api.sportradar.com/tennis/${this.accessLevel}/v3/en/sport_events/${encodeURIComponent(matchRef)}/summary.json`;
    const res = await this.fetcher(url, { headers: { "x-api-key": this.apiKey, accept: "application/json" } });
    const raw: unknown = await res.json().catch(() => ({ unreadable_body: true }));
    const normalised: NormalisedResult = res.ok
      ? normaliseSportradar(matchRef, raw as SrSummary)
      : { match_ref: matchRef, status: "unknown", players: [], winner: null, set_scores: [] };
    return { http_status: res.status, raw, normalised };
  }
}
