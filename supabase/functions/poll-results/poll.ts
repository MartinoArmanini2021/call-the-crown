// One run of the poller, independent of where it runs: the edge function (index.ts) gives it a
// Supabase client, the local stand-in and the simulation give it a direct database connection.
// It only carries: every decision about a result is made by public.ingest_result.
import { dueMatches, type MatchWindowRow } from "./due.ts";
import type { ResultsAdapter } from "./adapters/types.ts";

export interface PollDb {
  appNow(): Promise<string>;
  allMatches(): Promise<MatchWindowRow[]>; // six rows: dueMatches decides what to fetch
  providerMatchRefs(provider: string): Promise<Map<number, string>>;
  ingest(provider: string, normalised: unknown, raw: unknown, httpStatus: number): Promise<{ outcome: string }>;
  heartbeat(ok: boolean, detail: string): Promise<void>;
}

export type PollOutcome = { match_no: number; outcome: string };

export async function pollOnce(db: PollDb, adapter: ResultsAdapter): Promise<PollOutcome[]> {
  const nowMs = Date.parse(await db.appNow());
  const due = dueMatches(await db.allMatches(), nowMs);
  if (due.length === 0) {
    await db.heartbeat(true, "no match in its window");
    return [];
  }
  const refs = await db.providerMatchRefs(adapter.provider);
  const out: PollOutcome[] = [];
  for (const m of due) {
    const ref = refs.get(m.match_no);
    if (!ref) {
      await db.heartbeat(false, `match ${m.match_no} has no ${adapter.provider} id in provider_map`);
      out.push({ match_no: m.match_no, outcome: "no provider id mapped" });
      continue;
    }
    const fetched = await adapter.fetchMatch(ref, { nowMs, startsAt: m.starts_at });
    const r = await db.ingest(adapter.provider, fetched.normalised, fetched.raw, fetched.http_status);
    out.push({ match_no: m.match_no, outcome: r.outcome });
    if (fetched.http_status >= 400) {
      await db.heartbeat(false, `${adapter.provider} answered ${fetched.http_status} for match ${m.match_no}`);
    }
  }
  return out;
}
