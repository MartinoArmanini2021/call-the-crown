// The poller over a direct database connection (PGlite), acting as the service role: used by the
// simulation and the local stand-in. The logic is the edge function's own (poll.ts).
import type { PGlite, Transaction } from "@electric-sql/pglite";
import {
  FixtureAdapter,
  type FixtureFile,
} from "../../supabase/functions/poll-results/adapters/fixture.ts";
import type { MatchWindowRow } from "../../supabase/functions/poll-results/due.ts";
import {
  pollOnce,
  type PollDb,
  type PollOutcome,
} from "../../supabase/functions/poll-results/poll.ts";
import fixtureEvent from "../../supabase/functions/poll-results/fixtures/event.json";

export const fixtureAdapter = () => new FixtureAdapter(fixtureEvent as FixtureFile);

function txDb(tx: Transaction): PollDb {
  return {
    appNow: async () =>
      String((await tx.query<{ n: string }>("select public.app_now()::text as n")).rows[0]!.n),
    scheduledMatches: async () =>
      (
        await tx.query<MatchWindowRow>(
          "select match_no, starts_at::text, status, refetch_requested_at::text from public.matches where status = 'scheduled'",
        )
      ).rows,
    providerMatchRefs: async (provider) =>
      new Map(
        (
          await tx.query<{ provider_ref: string; our_ref: string }>(
            "select provider_ref, our_ref from public.provider_map where provider = $1 and kind = 'match'",
            [provider],
          )
        ).rows.map((r) => [Number(r.our_ref), r.provider_ref]),
      ),
    ingest: async (provider, normalised, raw, httpStatus) =>
      (
        await tx.query<{ r: { outcome: string } }>(
          "select public.ingest_result($1, $2::jsonb, $3::jsonb, $4) as r",
          [provider, JSON.stringify(normalised), JSON.stringify(raw), httpStatus],
        )
      ).rows[0]!.r,
    heartbeat: async (ok, detail) => {
      await tx.query("select public.ingest_heartbeat($1, $2)", [ok, detail]);
    },
  };
}

export async function pollAsService(
  db: PGlite,
  adapter = fixtureAdapter(),
): Promise<PollOutcome[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await tx.exec("set local role service_role");
    return pollOnce(txDb(tx), adapter);
  });
}
