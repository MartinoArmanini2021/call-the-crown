// The one shape every results provider is turned into before it reaches the database
// (public.ingest_result, supabase/migrations/0007_ingest_ops.sql). Provider ids stay provider ids;
// the database translates them through provider_map.
//
// No provider adapter ever decides a result is valid. It only translates. The database checks the
// set scores, the winner and the players, logs the raw payload, and settles only a final, consistent
// result.

export type ResultStatus = "scheduled" | "live" | "completed" | "retired" | "walkover" | "unknown";

export type NormalisedResult = {
  match_ref: string;                    // the provider's match id
  status: ResultStatus;
  players: [string, string] | [];       // the provider's player ids, in the order set_scores uses
  winner: string | null;                // a provider player id
  set_scores: { p1_games: number; p2_games: number }[];  // games only; tiebreak points are dropped
  scheduled_at?: string | null;         // the provider's start time, for the start-time check
};

export type FetchedResult = {
  http_status: number;
  raw: unknown;                          // stored as-is in result_log
  normalised: NormalisedResult;
};

// What the poller knows about the match when it asks (only the fixture adapter uses it, to replay
// results in time; a real provider ignores it).
export type FetchContext = { nowMs: number; startsAt: string | null };

export interface ResultsAdapter {
  readonly provider: string;             // the provider name used in provider_map and result_log
  fetchMatch(matchRef: string, ctx: FetchContext): Promise<FetchedResult>;
}
