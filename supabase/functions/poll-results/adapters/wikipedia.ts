// Wikipedia — the results source chosen by Tino on 1 Oct 2026 ("Wikipedia now, Sportradar if it
// lands"). Reads the event article's results bracket ({{#invoke:bracket|8TeamBracket …}}, the format
// of the 2024 and 2025 Six Kings Slam pages) through the MediaWiki API: one request per poll run,
// whatever the number of matches due.
//
// How a match reads on the page:
//   the winner's name is in bold (''' … ''')       → final; no bold → live or not started
//   a set score: games, with tiebreak points in <sup> (7<sup>7</sup> → 7)
//   a retirement: <sup>r</sup> (or "ret.") next to a score → status retired
//   a walkover: "w/o" in a score or name cell        → status walkover
//   both names in bold                               → unknown (an editing mistake): never final
// The adapter only translates. Everything that guards against a wrong page — a legal score that the
// winner actually wins, the right players, no result before the start, and above all "the same
// result for 10 minutes" against vandalism (event_config.results_policy) — happens in the database.
//
// Match refs are the bracket slots: "RD1:3-4", "RD1:5-6" (quarter-finals, after the two byes),
// "RD2:1-2", "RD2:3-4" (semi-finals), "RD3:1-2" (final), "3rd:1-2" (third place).
// Player refs are the article titles the names link to ("Jannik Sinner").
// Wikimedia's API policy asks for a descriptive User-Agent with a contact: WIKIPEDIA_USER_AGENT.
import type { FetchContext, FetchedResult, NormalisedResult, ResultStatus, ResultsAdapter } from "./types.ts";

type Cell = { raw: string; line: string };
export type ParsedMatch = { ref: string; result: Omit<NormalisedResult, "match_ref">; lines: string[] };

const PARAM = /^\|\s*(RD\d+|3rd)-(team|score|seed)0*(\d+)(?:-(\d+))?\s*=(.*)$/;
const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;
const RETIRED = /<sup>\s*r(?:et)?\.?\s*<\/sup>|\bret(?:ired|\.)?(?![a-z])/i;
const WALKOVER = /\bw\/o\b|\bw\.o\.?(?![a-z])/i;

const stripMarkup = (s: string) =>
  s
    .replace(/<sup>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/'{2,}/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();

function games(cell: Cell | undefined): number | null {
  if (!cell) return null;
  const s = stripMarkup(cell.raw);
  return /^\d{1,2}$/.test(s) ? Number(s) : null;
}

// MediaWiki treats these spellings of a link as the same article: underscores for spaces, repeated
// spaces, a lower-case first letter, a #section (audit O1, 5 Oct 2026). provider_map holds the canonical form.
export function canonicalTitle(t: string): string {
  const s = t.split("#")[0]!.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function team(cell: Cell | undefined): { ref: string | null; bold: boolean } {
  if (!cell) return { ref: null, bold: false };
  const link = LINK.exec(cell.raw);
  const ref = link ? canonicalTitle(link[1]!) : stripMarkup(cell.raw) || null;
  return { ref: ref && !/^(tbd|tba|bye)$/i.test(ref) ? ref : null, bold: cell.raw.includes("'''") };
}

/** Every match in the page's results bracket, keyed by slot pair. Pure: no network. */
export function parseBracket(wikitext: string): Map<string, ParsedMatch> {
  const cells = new Map<string, Cell>(); // "RD1|team|3" or "RD1|score|3|1"
  for (const line of wikitext.split("\n")) {
    const m = PARAM.exec(line.trim());
    if (!m) continue;
    const [, round, kind, slot, set, value] = m;
    const key = kind === "score" ? `${round}|score|${Number(slot)}|${Number(set)}` : `${round}|${kind}|${Number(slot)}`;
    cells.set(key, { raw: value ?? "", line: line.trim() });
  }

  const out = new Map<string, ParsedMatch>();
  const rounds = [...new Set([...cells.keys()].map((k) => k.split("|")[0]!))];
  for (const round of rounds) {
    for (let a = 1; a <= 15; a += 2) {
      const b = a + 1;
      const t1Cell = cells.get(`${round}|team|${a}`);
      const t2Cell = cells.get(`${round}|team|${b}`);
      if (!t1Cell && !t2Cell) continue;
      const t1 = team(t1Cell);
      const t2 = team(t2Cell);
      const lines: string[] = [];
      for (const [k, c] of cells) {
        const [r, , s] = k.split("|");
        if (r === round && (Number(s) === a || Number(s) === b)) lines.push(c.line);
      }

      const set_scores: { p1_games: number; p2_games: number }[] = [];
      let anyScore = false;
      let retired = false;
      let walkover = WALKOVER.test(t1Cell?.raw ?? "") || WALKOVER.test(t2Cell?.raw ?? "");
      for (let n = 1; n <= 5; n++) {
        const c1 = cells.get(`${round}|score|${a}|${n}`);
        const c2 = cells.get(`${round}|score|${b}|${n}`);
        for (const c of [c1, c2]) {
          if (!c) continue;
          // only a game count or a retirement/walkover marker means play has begun: placeholder text
          // ("&nbsp;", "–") in an empty cell would otherwise read as live from the window's opening and,
          // through 0018 real_start, void every pick saved in the hour before the start (audit O1)
          if (games(c) !== null || RETIRED.test(c.raw) || WALKOVER.test(c.raw)) anyScore = true;
          if (RETIRED.test(c.raw)) retired = true;
          if (WALKOVER.test(c.raw)) walkover = true;
        }
        const g1 = games(c1);
        const g2 = games(c2);
        if (g1 !== null && g2 !== null) set_scores.push({ p1_games: g1, p2_games: g2 });
      }

      let status: ResultStatus;
      let winner: string | null = null;
      if (!t1.ref || !t2.ref) status = "scheduled";
      else if (t1.bold && t2.bold) status = "unknown";
      else if (t1.bold || t2.bold) {
        winner = t1.bold ? t1.ref : t2.ref;
        status = walkover ? "walkover" : retired ? "retired" : "completed";
      } else status = anyScore ? "live" : "scheduled";

      out.set(`${round}:${a}-${b}`, {
        ref: `${round}:${a}-${b}`,
        result: {
          status,
          players: t1.ref && t2.ref ? [t1.ref, t2.ref] : [],
          winner,
          set_scores: status === "walkover" ? [] : set_scores,
        },
        lines,
      });
    }
  }
  return out;
}

type Page = { http_status: number; title: string; revid?: number; timestamp?: string; content?: string; error?: string };

export class WikipediaAdapter implements ResultsAdapter {
  readonly provider = "wikipedia";
  private page: Promise<Page> | null = null; // one request per poll run

  constructor(
    private readonly title: string,
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly host = "https://en.wikipedia.org",
  ) {
    if (!title) throw new Error("WIKIPEDIA_PAGE is not set");
    if (!userAgent) throw new Error("WIKIPEDIA_USER_AGENT is not set (Wikimedia asks for a contact)");
  }

  private load(): Promise<Page> {
    this.page ??= (async (): Promise<Page> => {
      const url =
        `${this.host}/w/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main` +
        `&format=json&formatversion=2&maxlag=5&redirects=1&titles=${encodeURIComponent(this.title)}`;
      try {
        // a hung request would hold the whole run (and pile runs up, one a minute): give up after 10 s (S-08)
        const res = await this.fetcher(url, {
          headers: { "User-Agent": this.userAgent, "Api-User-Agent": this.userAgent },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { http_status: res.status, title: this.title, error: `HTTP ${res.status}` };
        const body = (await res.json()) as {
          error?: { code?: string; info?: string };
          query?: { pages?: { missing?: boolean; revisions?: { revid: number; timestamp: string; slots: { main: { content: string } } }[] }[] };
        };
        if (body.error) return { http_status: 503, title: this.title, error: `${body.error.code}: ${body.error.info ?? ""}` };
        const p = body.query?.pages?.[0];
        const rev = p?.revisions?.[0];
        if (!p || p.missing || !rev) return { http_status: 404, title: this.title, error: "page does not exist yet" };
        const content = rev.slots.main.content;
        if (/^\s*#REDIRECT/i.test(content)) return { http_status: 200, title: this.title, revid: rev.revid, error: "the page is a redirect" };
        if (!content.trim()) return { http_status: 200, title: this.title, revid: rev.revid, error: "the page is empty" };
        return { http_status: 200, title: this.title, revid: rev.revid, timestamp: rev.timestamp, content };
      } catch (e) {
        return { http_status: 599, title: this.title, error: e instanceof Error ? e.message : String(e) };
      }
    })();
    return this.page;
  }

  async fetchMatch(matchRef: string, _ctx: FetchContext): Promise<FetchedResult> {
    const page = await this.load();
    const unknown: NormalisedResult = { match_ref: matchRef, status: "unknown", players: [], winner: null, set_scores: [] };
    const source = {
      source: "wikipedia",
      title: page.title,
      revid: page.revid ?? null,
      timestamp: page.timestamp ?? null,
      url: page.revid ? `${this.host}/w/index.php?oldid=${page.revid}` : null,
    };
    if (!page.content) return { http_status: page.http_status, raw: { ...source, error: page.error }, normalised: unknown };
    const match = parseBracket(page.content).get(matchRef);
    if (!match) return { http_status: 200, raw: { ...source, error: `no ${matchRef} in the bracket` }, normalised: unknown };
    // raw = exactly the bracket lines that produced this reading, plus the revision to re-check them
    return { http_status: 200, raw: { ...source, lines: match.lines }, normalised: { match_ref: matchRef, ...match.result } };
  }
}
