/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// O5: the one live read-only check, replayed offline. On 5 Oct 2026 at 20:45 UTC the MediaWiki API was
// asked once (the adapter's own URL, descriptive User-Agent) for "2026 Six Kings Slam", the page the
// poller is configured for (README / WIKIPEDIA_PAGE; provider_map holds the slot ids on that page).
// Saved as fixtures/live-2026-10-05-2026_Six_Kings_Slam.api.json (+ the response headers).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WikipediaAdapter } from "../../../supabase/functions/poll-results/adapters/wikipedia.ts";

const body = readFileSync(
  join(import.meta.dir, "fixtures", "live-2026-10-05-2026_Six_Kings_Slam.api.json"),
  "utf8",
);
const fetcher = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

describe("O5 the 2026 article, as fetched on 5 Oct 2026", () => {
  it("does not exist yet", () => {
    const j = JSON.parse(body);
    expect(j.query.pages[0]).toMatchObject({ title: "2026 Six Kings Slam", missing: true });
  });

  it("the real adapter turns it into 'unknown' with HTTP 404 for every mapped slot: nothing can settle", async () => {
    const a = new WikipediaAdapter("2026 Six Kings Slam", "audit-test (ops@example.test)", fetcher);
    for (const ref of ["RD1:3-4", "RD1:5-6", "RD2:1-2", "RD2:3-4", "3rd:1-2", "RD3:1-2"]) {
      const r = await a.fetchMatch(ref, {
        nowMs: Date.parse("2026-10-21T18:00:00Z"),
        startsAt: null,
      });
      expect(r.http_status).toBe(404);
      expect(r.normalised).toMatchObject({ status: "unknown", players: [], winner: null });
      expect((r.raw as any).error).toBe("page does not exist yet");
    }
  });
});
