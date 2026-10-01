import { useState, type ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localTime, matchState, scoreLine, shortTimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PlayerBadge, playerName } from "./Brand";

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

/** Where a still-unknown player comes from: "the winner of Quarter-final 1" (from the bracket's sources). */
function useSourceText() {
  const { t } = useT();
  const label = useMatchLabel();
  return (m: Match, which: 1 | 2, matches: Match[]): string => {
    const src = which === 1 ? m.p1_source : m.p2_source;
    const from = src.type !== "player" ? matches.find((x) => x.match_no === src.match) : undefined;
    if (!from) return "TBD";
    return t(src.type === "loser" ? "loser_of" : "winner_of", { match: label(from, matches) });
  };
}

export function MatchCard({
  match,
  matches,
  players,
  pick,
  now,
  children,
  defaultOpen = false,
  after,
}: {
  match: Match;
  matches: Match[];
  players: Map<string, Player>;
  pick: Pick | undefined;
  now: number;
  children?: ReactNode; // the editor, when picks are open and the fan is signed in
  defaultOpen?: boolean;
  after?: ReactNode; // shown at the bottom of the card whatever its state (the points breakdown)
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const label = useMatchLabel();
  const source = useSourceText();
  const state = matchState(match, now);
  const [open, setOpen] = useState(defaultOpen);

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
              <span className="text-sm font-normal text-ink-3">
                {t("waiting_players", { source: source(match, slot, matches) })}
              </span>
            )}
            {picked && (
              <span className="ms-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-text">
                {t("your_pick")}
              </span>
            )}
          </p>
          {p && <p className="text-[11px] text-ink-3">#{p.rank_snapshot}</p>}
        </div>
        {state !== "settled" && pts !== null && (
          <span className="num text-sm text-ink-2">{pts}</span>
        )}
        {won && <span className="text-sm font-bold text-good">✓</span>}
      </div>
    );
  };

  return (
    <article className="card p-4" aria-label={label(match, matches)}>
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="headline text-lg">{label(match, matches)}</h3>
        <span className="text-[11px] text-ink-3">
          {match.starts_at
            ? localTime(match.starts_at, event.timezone, locale)
            : t("waiting_start")}
        </span>
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
          <span className="num text-ink-3">
            {t("your_pick")}: {scoreLine(pick.set_scores)}
          </span>
        )}
        {state === "open" && children && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="focus-ring rounded-full bg-raised px-3 py-1.5 font-semibold"
            aria-expanded={open}
          >
            {pick ? `${t("your_pick")}: ${scoreLine(pick.set_scores)}` : t("save_pick")}
            <span aria-hidden className="ms-1.5">
              {open ? "▴" : "▾"}
            </span>
          </button>
        )}
      </footer>

      {state === "open" && open && children}
      {after}
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
