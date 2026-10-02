// One finished (or in-play) match on the Results screen: the result and your pick set by set, the
// sets you called exactly in green, and the points the server stored. Nothing is worked out here:
// the green marks are picks.exact_flags, the points are picks.pts_*.
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";

export function ResultCard({
  match,
  matches,
  pick,
  players,
  signedIn,
}: {
  match: Match;
  matches: Match[];
  pick: Pick | undefined;
  players: Map<string, Player>;
  signedIn: boolean;
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const label = useMatchLabel();
  const settled = match.status !== "scheduled";
  const short = (id: string | null) => {
    const name = playerName(id ? players.get(id) : undefined, locale);
    return surname(name);
  };
  const loser = match.winner_id === match.p1_id ? match.p2_id : match.p1_id;
  const resultSets = match.set_scores ?? [];
  const pickSets = pick?.set_scores ?? [];
  const columns = Math.max(resultSets.length, pickSets.length, 2);
  const scored = pick?.pts_total !== null && pick?.pts_total !== undefined;
  const upset = scored && (pick.pts_winner ?? 0) > event.rules.winner_points[match.round];

  const cell = (s: { p1_games: number; p2_games: number } | undefined, hit = false) => (
    <span
      className={cn(
        "num rounded-md py-1 text-center text-[13px]",
        s ? (hit ? "bg-good/20 text-good" : "bg-raised") : "bg-raised/40 text-ink-3",
      )}
    >
      {s ? `${s.p1_games}-${s.p2_games}` : "–"}
    </span>
  );

  return (
    <article className="card space-y-3 p-4" aria-label={label(match, matches)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
            {label(match, matches)}
          </p>
          <h3 className="headline truncate text-xl">
            {settled
              ? t("beat", { w: short(match.winner_id), l: short(loser) })
              : `${short(match.p1_id)} – ${short(match.p2_id)}`}
          </h3>
        </div>
        {!settled ? (
          <span className="shrink-0 rounded-full bg-accent/20 px-2.5 py-1 text-[11px] font-bold text-accent-text">
            {t("tile_live")}
          </span>
        ) : signedIn ? (
          <span
            className={cn(
              "num shrink-0 rounded-full px-2.5 py-1 text-[12px]",
              scored && pick.pts_total! > 0 ? "bg-good/15 text-good" : "bg-raised text-ink-3",
            )}
          >
            {scored ? t("plus_pts", { points: pick.pts_total! }) : t("tile_no_pick")}
          </span>
        ) : null}
      </header>

      <div
        className="grid items-center gap-1.5"
        style={{ gridTemplateColumns: `3.5rem repeat(${columns}, minmax(0, 1fr))` }}
      >
        <span />
        {Array.from({ length: columns }, (_, i) => (
          <span key={i} className="text-center text-[10px] uppercase tracking-wider text-ink-3">
            {t("set_n", { n: i + 1 })}
          </span>
        ))}
        {settled && (
          <>
            <span className="text-[11px] text-ink-3">{t("row_result")}</span>
            {Array.from({ length: columns }, (_, i) => (
              <span key={i} className="contents">
                {cell(resultSets[i])}
              </span>
            ))}
          </>
        )}
        {signedIn && pick && (
          <>
            <span className="text-[11px] text-ink-3">
              {t("row_you")} · {short(pick.winner_id)}
            </span>
            {Array.from({ length: columns }, (_, i) => (
              <span key={i} className="contents">
                {cell(pickSets[i], pick.exact_flags?.[i] === true)}
              </span>
            ))}
          </>
        )}
      </div>

      {settled && match.status !== "completed" && (
        <p className="text-[11px] text-ink-3">
          {t("void_note", {
            status: t(match.status === "retired" ? "retired" : "walkover").toLowerCase(),
          })}
        </p>
      )}
      {settled && signedIn && scored && (
        <p className="text-[12px] text-ink-2">
          {pick.pts_winner === 0
            ? t("wrong_winner")
            : t("breakdown_line", {
                w: `${pick.pts_winner}${upset ? ` ${t("upset_tag")}` : ""}`,
                s: pick.pts_sets ?? 0,
                e: pick.pts_exact ?? 0,
              })}
        </p>
      )}
    </article>
  );
}
