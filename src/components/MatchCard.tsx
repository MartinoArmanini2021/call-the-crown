import type { ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localTime, matchState, scoreLine, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PlayerBadge, playerName } from "./Brand";
import { useMatchNames } from "./matchNames";

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

export function MatchCard({
  match,
  matches,
  players,
  pick,
  now,
  action,
}: {
  match: Match;
  matches: Match[];
  players: Map<string, Player>;
  pick: Pick | undefined;
  now: number;
  action?: ReactNode; // the "Make pick" / "Edit" button, when picks are open
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const label = useMatchLabel();
  const { slot: slotNames, title } = useMatchNames(players);
  const state = matchState(match, now);

  const row = (slot: 1 | 2) => {
    const id = slot === 1 ? match.p1_id : match.p2_id;
    const p = id ? players.get(id) : undefined;
    const pts = slot === 1 ? match.p1_win_points : match.p2_win_points;
    const won = match.winner_id !== null && match.winner_id === id;
    const picked = pick?.winner_id === id && id !== null;
    return (
      <div className="flex items-center gap-3">
        <PlayerBadge player={p} size={36} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", match.winner_id && !won && "text-ink-3")}>
            {p ? (
              playerName(p, locale)
            ) : (
              <span className="font-normal text-ink-2">{slotNames(match, slot, matches)}</span>
            )}
            {picked && (
              <span className="ms-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-text">
                {t("your_pick")}
              </span>
            )}
          </p>
          {p && (
            <p className="text-[11px] text-ink-3">
              {t("world_rank", { rank: p.rank_snapshot ?? "–" })}
            </p>
          )}
        </div>
        {state !== "settled" && pts !== null && (
          <span className="text-xs text-ink-3">
            <span className="num text-sm text-ink-2">{pts}</span> {t("pts")}
          </span>
        )}
        {won && <span className="text-sm font-bold text-good">✓</span>}
      </div>
    );
  };

  return (
    <article className="card p-4" aria-label={title(match, matches)}>
      <header className="mb-3">
        <p className="flex justify-between gap-2 text-[11px] text-ink-3">
          <span className="font-bold uppercase tracking-wider">{label(match, matches)}</span>
          <span>
            {match.starts_at
              ? localTime(match.starts_at, event.timezone, locale)
              : t("waiting_start")}
          </span>
        </p>
        <h3 className="headline text-xl leading-tight">{title(match, matches)}</h3>
      </header>

      <div className="space-y-2.5">
        {row(1)}
        {row(2)}
      </div>

      <footer className="mt-3 flex items-center justify-between gap-2 text-xs">
        {state === "settled" ? (
          <span>
            <span className="text-ink-3">
              {t(
                match.status === "completed"
                  ? "result"
                  : match.status === "retired"
                    ? "retired"
                    : "walkover",
              )}
            </span>{" "}
            <span className="num font-bold">{scoreLine(match.set_scores)}</span>
          </span>
        ) : (
          <Status state={state} startsAt={match.starts_at} now={now} />
        )}
        {pick && state !== "open" && (
          <span className="text-ink-3">
            {t("your_pick")}:{" "}
            {t("pick_summary", {
              name: surname(playerName(players.get(pick.winner_id), locale)),
              n: pick.sets,
            })}
          </span>
        )}
        {state === "open" && action}
      </footer>
    </article>
  );
}

function Status({ state, startsAt, now }: { state: string; startsAt: string | null; now: number }) {
  const { t } = useT();
  if (state === "open" && startsAt) {
    const left = Date.parse(startsAt) - now;
    return (
      <span className={cn("font-semibold", left < 3_600_000 ? "text-accent-text" : "text-ink-2")}>
        {t("locks_in", { time: shortTimeLeft(left) })}
      </span>
    );
  }
  if (state === "locked")
    return <span className="font-semibold text-accent-text">● {t("live_now")}</span>;
  if (state === "settled") return <span className="text-ink-3">{t("result")}</span>;
  return (
    <span className="text-ink-3">{startsAt ? t("opens_when_known") : t("waiting_start")}</span>
  );
}
