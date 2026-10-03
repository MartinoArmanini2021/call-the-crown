import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localTime, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchNames } from "./matchNames";
import { SIDE_COLOR } from "./sides";

/** "Quarter-final 1", "Semi-final 2", "Third place", "Final". */
export function useMatchLabel() {
  const { t } = useT();
  return (m: Match, matches: Match[]) => {
    const same = matches.filter((x) => x.round === m.round);
    const n = same.findIndex((x) => x.match_no === m.match_no) + 1;
    return same.length > 1
      ? t("match_label", { round: t(`round_${m.round}`), n })
      : t(`round_${m.round}`);
  };
}

/**
 * An open match on Picks (Tino, 3 Oct 2026: "sell the idea of picking, without being pushy"). The
 * match name leads, big. The two players are the way in: "Who wins?" with each player as a tile
 * (world ranking, the points a right call is worth, the upset bonus when there is one); tapping a
 * player opens the pick sheet with that player already chosen. The footer shows the stake and the
 * lock; once picked, the tile is marked and the button says "Edit pick". Points are the stored
 * potential winner points; the stake is a ceiling from them and the configured set points.
 */
export function MatchCard({
  match,
  matches,
  players,
  pick,
  now,
  onPick,
}: {
  match: Match;
  matches: Match[];
  players: Map<string, Player>;
  pick: Pick | undefined;
  now: number;
  /** open the pick sheet; with a side, that player starts as the winner */
  onPick: (side?: 1 | 2) => void;
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const label = useMatchLabel();
  const { title } = useMatchNames(players);
  const base = event.rules.winner_points[match.round];
  const points = { 1: match.p1_win_points, 2: match.p2_win_points } as const;
  const best = Math.max(points[1] ?? 0, points[2] ?? 0);
  const stake = best + event.rules.sets_points[match.round] + 3 * event.rules.per_set_exact;
  const left = match.starts_at ? Date.parse(match.starts_at) - now : null;

  const tile = (side: 1 | 2) => {
    const id = side === 1 ? match.p1_id : match.p2_id;
    const p = id ? players.get(id) : undefined;
    const pts = points[side];
    const mine = pick?.winner_id === id && id !== null;
    return (
      <button
        type="button"
        onClick={() => onPick(pick ? undefined : side)}
        aria-pressed={mine}
        aria-label={`${p ? playerName(p, locale) : ""}${pts !== null ? `, ${t("pts_if_right", { points: pts })}` : ""}`}
        className={cn(
          "focus-ring flex flex-col items-start rounded-2xl px-3 py-3 text-start transition-colors",
          mine ? SIDE_COLOR[side].chosen : "bg-raised hover:bg-raised/70",
        )}
      >
        <span className="flex w-full items-center gap-1.5">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", SIDE_COLOR[side].dot)} />
          <span className="headline truncate text-xl leading-tight text-ink">
            {p ? surname(playerName(p, locale)) : ""}
          </span>
        </span>
        {p && (
          <span className="ps-3.5 text-[11px] text-ink-3">
            {t("world_rank", { rank: p.rank_snapshot ?? "–" })}
          </span>
        )}
        {pts !== null && (
          <span className="mt-1.5 ps-3.5 text-xs">
            <b className="num text-ink">{pts}</b> <span className="text-ink-3">{t("pts")}</span>
            {pts > base && (
              <span className="ms-1.5 inline-block whitespace-nowrap rounded bg-gold/15 px-1 py-0.5 text-[10px] font-bold uppercase text-gold">
                {t("upset_bonus")}
              </span>
            )}
          </span>
        )}
        {mine && (
          <span className="mt-1.5 ps-3.5 text-[10px] font-bold uppercase tracking-wider">
            ✓ {t("your_pick")}
          </span>
        )}
      </button>
    );
  };

  return (
    <article className="card p-4" aria-label={title(match, matches)}>
      <header>
        <p className="flex justify-between gap-2 text-[11px] text-ink-3">
          <span className="font-bold uppercase tracking-wider">{label(match, matches)}</span>
          <span>
            {match.starts_at
              ? localTime(match.starts_at, event.timezone, locale)
              : t("waiting_start")}
          </span>
        </p>
        <h3 className="headline mt-1 text-3xl leading-none">{title(match, matches)}</h3>
      </header>

      <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-3">
        {t("card_who_wins")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {tile(1)}
        {tile(2)}
      </div>

      <footer className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 text-ink-2">
          {pick ? (
            <b className="text-ink">
              {t("pick_summary", {
                name: surname(playerName(players.get(pick.winner_id), locale)),
                n: pick.sets,
              })}
            </b>
          ) : (
            <>{t("card_stake", { points: stake })}</>
          )}
          {left !== null && (
            <span className={cn("block", left < 3_600_000 ? "text-accent-text" : "text-ink-3")}>
              {t("locks_in", { time: shortTimeLeft(left, locale) })}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onPick()}
          className={cn(
            "focus-ring shrink-0 rounded-full px-4 py-2 text-sm font-bold",
            pick ? "bg-raised text-ink ring-1 ring-inset ring-ink-3" : "bg-accent text-ink",
          )}
        >
          {pick ? t("edit_pick") : t("make_pick")}
        </button>
      </footer>
    </article>
  );
}
