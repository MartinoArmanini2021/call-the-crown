// Which matches the poller fetches on this run: every unsettled match from 15 minutes before its
// start, plus any match the operator asked to re-fetch. Pure, so the local simulation uses it too.
export type MatchWindowRow = {
  match_no: number;
  starts_at: string | null;
  status: string;
  refetch_requested_at: string | null;
};

export const WINDOW_LEAD_MS = 15 * 60_000;

export function dueMatches(rows: MatchWindowRow[], nowMs: number): MatchWindowRow[] {
  return rows.filter(
    (m) =>
      m.status === "scheduled" &&
      (m.refetch_requested_at !== null ||
        (m.starts_at !== null && Date.parse(m.starts_at) - WINDOW_LEAD_MS <= nowMs)),
  );
}
