// Which matches the poller fetches on this run. Pure, so the local simulation and the tests use it too.
//   - an unsettled match: from 60 minutes before its start, every run, so a match that starts early is
//     seen (audit F-03; it was 15 minutes);
//   - any match the operator asked to re-fetch, or whose result is waiting to be confirmed (ingest_result
//     sets the same flag, audit F-09): every run;
//   - a settled match: still watched for 12 hours, so a provider's later correction is seen (brief:
//     re-settle idempotently, log the difference, alert). Every run for the first 30 minutes, then
//     every 10 minutes.
export type MatchWindowRow = {
  match_no: number;
  starts_at: string | null;
  status: string;
  refetch_requested_at: string | null;
  settled_at: string | null;
};

export const WINDOW_LEAD_MS = 60 * 60_000;
export const WATCH_AFTER_SETTLE_MS = 12 * 60 * 60_000;
const EVERY_RUN_AFTER_SETTLE_MS = 30 * 60_000;
const SLOW_EVERY_MS = 10 * 60_000;

export function dueMatches(rows: MatchWindowRow[], nowMs: number): MatchWindowRow[] {
  return rows.filter((m) => {
    if (m.refetch_requested_at !== null) return true;
    if (m.status === "scheduled") {
      return m.starts_at !== null && Date.parse(m.starts_at) - WINDOW_LEAD_MS <= nowMs;
    }
    if (m.settled_at === null) return false;
    const since = nowMs - Date.parse(m.settled_at);
    if (since < 0 || since > WATCH_AFTER_SETTLE_MS) return false;
    if (since <= EVERY_RUN_AFTER_SETTLE_MS) return true;
    return Math.floor(nowMs / 60_000) % (SLOW_EVERY_MS / 60_000) === 0;
  });
}
