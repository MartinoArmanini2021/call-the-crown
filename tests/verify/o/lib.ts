/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// Section O helpers: the real 2026 draw file (players, schedule, provider_map) on PGlite, the real
// Wikipedia adapter fed by a fake MediaWiki API, and the real poller (pollOnce, via scripts/lib/poller).
// Nothing here touches the network or the shared local stack.
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "../../../scripts/lib/db";
import { pollAsService } from "../../../scripts/lib/poller";
import { WikipediaAdapter } from "../../../supabase/functions/poll-results/adapters/wikipedia.ts";

export type Side = {
  link?: string; // article title, rendered as [[link]]
  raw?: string; // raw wikitext for the name, instead of [[link]]
  flag?: string;
  bold?: boolean;
  scores?: string[]; // raw score cells, set 1..3
};

export const P = {
  fritz: { link: "Taylor Fritz", flag: "USA" },
  zverev: { link: "Alexander Zverev", flag: "GER" },
  deminaur: { link: "Alex de Minaur", flag: "AUS" },
  sinner: { link: "Jannik Sinner", flag: "ITA" },
  alcaraz: { link: "Carlos Alcaraz", flag: "ESP" },
  djokovic: { link: "Novak Djokovic", flag: "SRB" },
} satisfies Record<string, Side>;

// The night-1 page as the 2024/2025 articles lay it out: QFs in RD1 slots 3-4 and 5-6 (byes 1 and 8),
// SF1 = RD2 1-2 (Alcaraz on top), SF2 = RD2 3-4 (Djokovic at the bottom), final RD3 1-2, 3rd 1-2.
export type Slots = Record<string, Side | null>;
export const baseSlots = (): Slots => ({
  "RD1:3": { ...P.fritz },
  "RD1:4": { ...P.zverev },
  "RD1:5": { ...P.deminaur },
  "RD1:6": { ...P.sinner },
  "RD2:1": { ...P.alcaraz },
  "RD2:2": null,
  "RD2:3": null,
  "RD2:4": { ...P.djokovic },
  "RD3:1": null,
  "RD3:2": null,
  "3rd:1": null,
  "3rd:2": null,
});

const cell = (s: Side | null) => {
  if (!s) return "";
  const name = s.raw ?? `[[${s.link}]]`;
  const inner = `${s.flag ? `{{flagicon|${s.flag}}} ` : ""}${name}`;
  return s.bold ? `'''${inner}'''` : inner;
};

export function wikitext(slots: Slots): string {
  const out = [
    "{{#invoke:bracket|8TeamBracket|compact=y|sets=3|nowrap=y|byes=1",
    "| 3rd=3rd place match",
    "",
  ];
  for (const [key, side] of Object.entries(slots)) {
    const [round, n] = key.split(":");
    const slot = round === "RD1" ? String(n).padStart(2, "0") : n;
    out.push(`| ${round}-seed${slot}=`);
    out.push(`| ${round}-team${slot}=${cell(side)}`);
    for (let set = 1; set <= 3; set++)
      out.push(`| ${round}-score${slot}-${set}=${side?.scores?.[set - 1] ?? ""}`);
    out.push("");
  }
  out.push("}}");
  return out.join("\n");
}

/** A slot pair finished: winner bold, scores bold on the sets each won (as editors do). */
export function finished(
  slots: Slots,
  a: string,
  b: string,
  winnerTop: boolean,
  sets: [number, number][],
) {
  const s = baseSlots();
  const A = { ...(slots[a] ?? s[a]!) };
  const B = { ...(slots[b] ?? s[b]!) };
  A.bold = winnerTop;
  B.bold = !winnerTop;
  A.scores = sets.map(([x, y]) => (x > y ? `'''${x}'''` : `${x}`));
  B.scores = sets.map(([x, y]) => (y > x ? `'''${y}'''` : `${y}`));
  return { ...slots, [a]: A, [b]: B };
}

// ---- the fake MediaWiki API ---------------------------------------------------------------------------
export type Answer = Response | "hang" | (() => Response | Promise<Response>);
export const apiPage = (content: string, revid = 1400000000) =>
  new Response(
    JSON.stringify({
      batchcomplete: true,
      query: {
        pages: [
          {
            ns: 0,
            title: "2026 Six Kings Slam",
            revisions: [{ revid, timestamp: "2026-10-21T16:00:00Z", slots: { main: { content } } }],
          },
        ],
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
export const apiMissing = () =>
  new Response(
    JSON.stringify({
      batchcomplete: true,
      query: { pages: [{ ns: 0, title: "2026 Six Kings Slam", missing: true }] },
    }),
    {
      status: 200,
    },
  );

export class FakeWiki {
  answer: () => Answer = () => apiPage(wikitext(baseSlots()));
  calls = 0;
  set(a: Answer | (() => Answer)) {
    this.answer =
      typeof a === "function" && !(a instanceof Response) ? (a as () => Answer) : () => a as Answer;
  }
  fetcher: typeof fetch = (async (_url: string, init?: RequestInit) => {
    this.calls++;
    let a = this.answer();
    // like a real fetch that never answers: only an abort signal (if the caller set one) ends it
    if (a === "hang")
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation timed out"))),
      );
    if (typeof a === "function") a = await a();
    return (a as Response).clone();
  }) as unknown as typeof fetch;
  adapter = () =>
    new WikipediaAdapter("2026 Six Kings Slam", "audit-test (ops@example.test)", this.fetcher);
}

// ---- the database ---------------------------------------------------------------------------------------
export type Ev = {
  db: PGlite;
  wiki: FakeWiki;
  at(iso: string): Promise<void>;
  poll(): Promise<Record<number, string>>;
  match(n: number): Promise<{
    status: string;
    p1_id: string;
    p2_id: string;
    winner_id: string | null;
    set_scores: unknown;
    settlement_paused: boolean;
  }>;
  health(): Promise<{ ok: boolean; detail: string } | undefined>;
  alerts(kind?: string): Promise<{ kind: string; detail: Record<string, unknown> }[]>;
  everyMinute(
    from: string,
    to: string,
    each?: (t: Date) => void | Promise<void>,
  ): Promise<Record<number, string>[]>;
};

export async function freshEvent(): Promise<Ev> {
  const db = await bootDb({ prelude: true });
  await db.query("select public.dev_set_now('2026-10-20 12:00+00')");
  // the real operator file: players, bracket, start times and the wikipedia provider_map
  await db.exec(readFileSync(join(ROOT, "supabase", "events", "sixkings_2026_draw.sql"), "utf8"));
  const wiki = new FakeWiki();
  const ev: Ev = {
    db,
    wiki,
    at: async (iso) => {
      await db.query("select public.dev_set_now($1)", [iso]);
    },
    poll: async () =>
      Object.fromEntries(
        (await pollAsService(db, wiki.adapter())).map((o) => [o.match_no, o.outcome]),
      ),
    match: async (n) =>
      (
        await db.query<any>(
          "select status, p1_id, p2_id, winner_id, set_scores, settlement_paused from public.matches where match_no = $1",
          [n],
        )
      ).rows[0],
    health: async () =>
      (await db.query<any>("select ok, detail from public.ops_health where key = 'poll-results'"))
        .rows[0],
    alerts: async (kind) =>
      (
        await db.query<any>(
          "select kind, detail from public.ops_alerts where $1::text is null or kind = $1 order by id",
          [kind ?? null],
        )
      ).rows,
    everyMinute: async (from, to, each) => {
      const out: Record<number, string>[] = [];
      for (let t = Date.parse(from); t <= Date.parse(to); t += 60_000) {
        if (each) await each(new Date(t));
        await ev.at(new Date(t).toISOString());
        out.push(await ev.poll());
      }
      return out;
    },
  };
  return ev;
}
