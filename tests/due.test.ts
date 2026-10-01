// Which matches the poller fetches on a run (supabase/functions/poll-results/due.ts).
import { describe, expect, it } from "bun:test";
import { dueMatches, type MatchWindowRow } from "../supabase/functions/poll-results/due.ts";

const START = "2026-10-21T16:30:00Z";
const row = (over: Partial<MatchWindowRow>): MatchWindowRow => ({
  match_no: 1,
  starts_at: START,
  status: "scheduled",
  refetch_requested_at: null,
  settled_at: null,
  ...over,
});
const at = (iso: string) => Date.parse(iso);
const due = (r: MatchWindowRow, iso: string) => dueMatches([r], at(iso)).length === 1;

describe("an unsettled match", () => {
  it("is not fetched more than 15 minutes before its start", () => {
    expect(due(row({}), "2026-10-21T16:14:00Z")).toBe(false);
  });
  it("is fetched from 15 minutes before its start, every run", () => {
    expect(due(row({}), "2026-10-21T16:15:00Z")).toBe(true);
    expect(due(row({}), "2026-10-21T23:00:00Z")).toBe(true);
  });
  it("without a start time is not fetched, unless the operator asks", () => {
    expect(due(row({ starts_at: null }), "2026-10-21T18:00:00Z")).toBe(false);
    expect(
      due(
        row({ starts_at: null, refetch_requested_at: "2026-10-21T18:00:00Z" }),
        "2026-10-21T18:00:00Z",
      ),
    ).toBe(true);
  });
});

describe("a settled match is still watched for corrections", () => {
  const settled = row({ status: "completed", settled_at: "2026-10-21T18:00:00Z" });
  it("every run for the first 30 minutes", () => {
    expect(due(settled, "2026-10-21T18:07:00Z")).toBe(true);
    expect(due(settled, "2026-10-21T18:29:00Z")).toBe(true);
  });
  it("then every 10 minutes, up to 12 hours", () => {
    expect(due(settled, "2026-10-21T19:07:00Z")).toBe(false);
    expect(due(settled, "2026-10-21T19:10:00Z")).toBe(true);
    expect(due(settled, "2026-10-22T05:50:00Z")).toBe(true);
  });
  it("and no longer after 12 hours, unless the operator asks", () => {
    expect(due(settled, "2026-10-22T06:10:00Z")).toBe(false);
    expect(
      due({ ...settled, refetch_requested_at: "2026-10-23T00:00:00Z" }, "2026-10-23T00:00:00Z"),
    ).toBe(true);
  });
});
