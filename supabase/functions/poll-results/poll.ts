// One run of the poller, independent of where it runs: the edge function (index.ts) gives it a
// Supabase client, the local stand-in and the simulation give it a direct database connection.
// It only carries: every decision about a result is made by public.ingest_result.
// Health (audit F-05, 3 Oct 2026): one heartbeat per run, written at the end from every match the run
// visited, healthy only if each one was mapped and answered. A match that throws is reported and the
// run carries on with the next one.
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
  const problems: string[] = [];
  for (const m of due) {
    const ref = refs.get(m.match_no);
    if (!ref) {
      problems.push(`match ${m.match_no} has no ${adapter.provider} id in provider_map`);
      out.push({ match_no: m.match_no, outcome: "no provider id mapped" });
      continue;
    }
    try {
      const fetched = await adapter.fetchMatch(ref, { nowMs, startsAt: m.starts_at });
      const r = await db.ingest(adapter.provider, fetched.normalised, fetched.raw, fetched.http_status);
      out.push({ match_no: m.match_no, outcome: r.outcome });
      const why = (fetched.raw as { error?: unknown } | null)?.error;
      if (fetched.http_status >= 400) {
        problems.push(`${adapter.provider} answered ${fetched.http_status} for match ${m.match_no}${why ? ` (${why})` : ""}`);
      } else if (fetched.normalised.status === "unknown") {
        // audit O1 (5 Oct 2026): an answer with no usable reading (blanked page, a redirect, no bracket,
        // the slot missing, both names in bold) is a broken feed, not a healthy one
        problems.push(`${adapter.provider} has no reading for match ${m.match_no}${why ? `: ${why}` : ""}`);
      } else if (fetched.normalised.players.length === 0 && m.starts_at && nowMs >= Date.parse(m.starts_at)) {
        problems.push(`${adapter.provider} does not name the players of match ${m.match_no}, which has started`);
      }
    } catch (e) {
      problems.push(`match ${m.match_no}: ${e instanceof Error ? e.message : String(e)}`);
      out.push({ match_no: m.match_no, outcome: "error" });
    }
  }
  await db.heartbeat(
    problems.length === 0,
    problems.length === 0 ? out.map((o) => `${o.match_no}:${o.outcome}`).join(" ") : problems.join("; "),
  );
  return out;
}
