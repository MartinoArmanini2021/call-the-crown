// The one thing a fan should do next, for the banner on Picks and the end of Results
// (first-time-fan test, 2 Oct 2026). Pure: the server's matches, the fan's picks and the server clock.
import type { Match } from "./api";
import { matchState } from "./format";

export type NextStep =
  /** an open match without a pick, the one that locks first */
  | { kind: "pick"; match: Match; msLeft: number }
  /** every open match is picked; msLeft = time to the next lock */
  | { kind: "all_set"; msLeft: number }
  /** nothing to pick: `match` opens once `after` has a result */
  | { kind: "waiting"; match: Match; after: Match }
  /** every match has a result */
  | { kind: "over" }
  /** nothing useful to say (no start times yet, or a match in play with nothing waiting on it) */
  | { kind: "none" };

const byStart = (a: Match, b: Match) =>
  Date.parse(a.starts_at ?? "9999") - Date.parse(b.starts_at ?? "9999") || a.match_no - b.match_no;

export function nextStep(matches: Match[], picked: Set<number>, now: number): NextStep {
  if (matches.length > 0 && matches.every((m) => m.status !== "scheduled")) return { kind: "over" };

  const open = matches.filter((m) => matchState(m, now) === "open").sort(byStart);
  const unpicked = open.find((m) => !picked.has(m.match_no));
  if (unpicked)
    return { kind: "pick", match: unpicked, msLeft: Date.parse(unpicked.starts_at!) - now };
  if (open[0]) return { kind: "all_set", msLeft: Date.parse(open[0].starts_at!) - now };

  // Nothing open: the next match still missing a player, and the unfinished match it waits for.
  for (const m of matches.filter((x) => matchState(x, now) === "waiting").sort(byStart)) {
    const sources = [m.p1_source, m.p2_source]
      .flatMap((s) => (s.type === "player" ? [] : matches.filter((x) => x.match_no === s.match)))
      .filter((x) => x.status === "scheduled")
      .sort(byStart);
    const after = sources[sources.length - 1];
    if (after) return { kind: "waiting", match: m, after };
  }
  return { kind: "none" };
}
