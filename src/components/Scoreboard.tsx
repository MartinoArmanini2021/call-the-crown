import { cn } from "@/lib/utils";
import { SIDE_COLOR } from "./sides";
import type { SetScore } from "@/lib/validation";

type Side = 1 | 2;

/**
 * A match as a TV scoreboard: one row per player in the match's fixed order (player 1 on top), each
 * set's games underneath its column, the winner marked ●. Used for a pick in the pick sheet and for
 * the result and your pick on Results, so the fixed order never reads as "who won" (Tino, 2 Oct
 * 2026: "it needs to be easy to understand"). `marks` = sets called exactly (picks.exact_flags,
 * written by settlement), shown green with a ✓.
 */
export function Scoreboard({
  names,
  winner,
  sets,
  n,
  columns = 3,
  title,
  marks,
  caption,
}: {
  names: Record<Side, string>;
  winner: Side | null;
  sets: (SetScore | null | undefined)[];
  /** sets in play; columns beyond it show "–" */
  n: number;
  columns?: number;
  title?: string | undefined;
  marks?: (boolean | null)[] | null | undefined;
  caption: string;
}) {
  const games = (s: Side, i: number) => {
    const set = sets[i];
    if (!set) return null;
    return s === 1 ? set.p1_games : set.p2_games;
  };
  const won = (s: Side, i: number) => {
    const set = sets[i];
    return !!set && (s === 1 ? set.p1_games > set.p2_games : set.p2_games > set.p1_games);
  };
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <table className="w-full table-fixed rounded-xl bg-raised text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-[9px] uppercase tracking-wider text-ink-3">
          <th className="px-3 pt-1.5 text-start font-bold">{title}</th>
          {cols.map((i) => (
            <th
              key={i}
              scope="col"
              className={cn(
                "w-10 pt-1.5 text-center font-semibold",
                marks?.[i] === true && "text-good",
              )}
            >
              S{i + 1}
              {marks?.[i] === true && " ✓"}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {([1, 2] as const).map((s) => (
          <tr key={s}>
            <th
              scope="row"
              className={cn("truncate px-3 py-1 text-start text-xs font-bold", SIDE_COLOR[s].text)}
            >
              {names[s]}
              {s === winner && <span className="text-accent-text"> ●</span>}
            </th>
            {cols.map((i) => {
              const g = i < n ? games(s, i) : null;
              return (
                <td
                  key={i}
                  className={cn(
                    "num py-1 text-center text-base",
                    marks?.[i] === true
                      ? "text-good"
                      : g === null
                        ? "text-ink-3"
                        : won(s, i)
                          ? SIDE_COLOR[s].text
                          : "text-ink-3",
                  )}
                >
                  {g ?? "–"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
