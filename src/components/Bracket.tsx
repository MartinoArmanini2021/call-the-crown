// The draw: the whole event on one phone screen, on Results (Tino, 2 Oct 2026: the draw belongs
// where fans see how the event stands). Quarter-finals, semi-finals, then the final and the
// third-place match, each column headed by its round in words and its day. What still needs your pick glows red with its own countdown; finished matches
// show the points you scored (stored by the server, never worked out here). Built from the bracket
// data (each slot's source), so it follows the organiser's real draw.
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localDay, matchState, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchNames } from "./matchNames";

const COLUMNS: { key: "bracket_qf" | "bracket_sf" | "bracket_last"; rounds: Match["round"][] }[] = [
  { key: "bracket_qf", rounds: ["QF"] },
  { key: "bracket_sf", rounds: ["SF"] },
  { key: "bracket_last", rounds: ["F", "3P"] },
];

export function Bracket({
  matches,
  players,
  pickByMatch,
  now,
  onSelect,
}: {
  matches: Match[];
  players: Map<string, Player>;
  pickByMatch: Map<number, Pick>;
  now: number;
  onSelect: (m: Match) => void;
}) {
  const { t, locale } = useT();
  const event = useEvent();
  const inColumn = (col: (typeof COLUMNS)[number]) =>
    col.rounds.flatMap((r) => matches.filter((m) => m.round === r));
  const dayOf = (col: (typeof COLUMNS)[number]) => {
    const first = inColumn(col).find((m) => m.starts_at)?.starts_at;
    return first ? localDay(first, event.timezone, locale) : "";
  };
  const { slot: slotNames } = useMatchNames(players);
  const short = (id: string | null) => {
    const p = id ? players.get(id) : undefined;
    if (!p) return "";
    const name = playerName(p, locale);
    return surname(name);
  };

  return (
    <div aria-label={t("draw_title")}>
      <div className="mb-2 grid grid-cols-3 items-end gap-2">
        {COLUMNS.map((col) => (
          <h3 key={col.key} className="text-center">
            <span className="headline block whitespace-nowrap text-[15px] leading-tight text-ink sm:text-lg">
              {t(col.key)}
            </span>
            <span className="block text-[11px] font-semibold text-ink-3">{dayOf(col)}</span>
          </h3>
        ))}
      </div>
      <div className="grid grid-cols-3 items-center gap-2">
        {COLUMNS.map((col) => (
          <div key={col.key} className="grid gap-2">
            {inColumn(col).map((m) => {
              const state = matchState(m, now);
              const pick = pickByMatch.get(m.match_no);
              const todo = state === "open" && !pick;
              const left = m.starts_at ? Date.parse(m.starts_at) - now : 0;
              const row = (slot: 1 | 2) => {
                const id = slot === 1 ? m.p1_id : m.p2_id;
                const games = (m.set_scores ?? []).map((s) =>
                  slot === 1 ? s.p1_games : s.p2_games,
                );
                const pts = slot === 1 ? m.p1_win_points : m.p2_win_points;
                const lost = m.winner_id !== null && m.winner_id !== id;
                return (
                  <span
                    className={cn(
                      "flex items-center justify-between gap-1",
                      lost && "text-ink-3",
                      m.winner_id === id && id && "font-bold",
                    )}
                  >
                    <span className={id ? "truncate" : "text-[11px] leading-tight text-ink-3"}>
                      {id ? short(id) : slotNames(m, slot, matches)}
                      {pick?.winner_id === id && id && <span className="text-accent-text"> ●</span>}
                    </span>
                    <span className="num shrink-0 text-[10px] text-ink-3">
                      {state === "settled"
                        ? games.join(" ")
                        : state === "open" && pts !== null
                          ? `${pts} ${t("pts")}`
                          : ""}
                    </span>
                  </span>
                );
              };
              const status =
                state === "open"
                  ? todo
                    ? t("tile_pick", { time: shortTimeLeft(left, locale) })
                    : t("tile_picked", { time: shortTimeLeft(left, locale) })
                  : state === "locked"
                    ? t("tile_live")
                    : state === "settled"
                      ? pick?.pts_total !== null && pick?.pts_total !== undefined
                        ? t("plus_pts", { points: pick.pts_total })
                        : t("tile_no_pick")
                      : t("tile_waiting");
              return (
                <button
                  key={m.match_no}
                  type="button"
                  onClick={() => onSelect(m)}
                  disabled={state === "waiting"}
                  aria-label={`${slotNames(m, 1, matches)} – ${slotNames(m, 2, matches)}: ${status}`}
                  className={cn(
                    "focus-ring grid gap-0.5 rounded-xl border bg-card p-2 text-start text-[12px] transition-colors",
                    todo ? "skg-glow border-accent" : "border-line hover:border-ink-3",
                    state === "waiting" && "opacity-60",
                  )}
                >
                  {(m.round === "F" || m.round === "3P") && (
                    <span className="text-[9px] uppercase tracking-wider text-ink-3">
                      {t(`round_${m.round}`)}
                    </span>
                  )}
                  {row(1)}
                  {row(2)}
                  <span
                    className={cn(
                      "mt-0.5 text-[9px] font-bold uppercase tracking-wide",
                      todo
                        ? "text-accent-text"
                        : state === "settled" && pick?.pts_total
                          ? "text-good"
                          : "text-ink-3",
                    )}
                  >
                    {status}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
