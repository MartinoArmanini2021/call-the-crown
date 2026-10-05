// One finished (or in-play) match on the Results screen: the result and your pick set by set, the
// sets you called exactly in green, and the points the server stored. Nothing is worked out here:
// the green marks are picks.exact_flags, the points are picks.pts_*.
import { useQuery } from "@tanstack/react-query";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import { crowdQuery, type Match, type Pick, type Player } from "@/lib/api";
import { localTime, scoreLine, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";
import { Scoreboard } from "./Scoreboard";

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

  const side = (id: string | null) => (id === null ? null : id === match.p1_id ? 1 : 2);
  const names = { 1: short(match.p1_id), 2: short(match.p2_id) };

  return (
    <article className="card space-y-3 p-4" aria-label={label(match, matches)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-wider text-ink-3">
            {label(match, matches)}
          </p>
          <h3 className="headline truncate text-xl">
            {settled
              ? t("beat", { w: short(match.winner_id), l: short(loser) })
              : `${short(match.p1_id)} – ${short(match.p2_id)}`}
          </h3>
        </div>
        {!settled ? (
          <span className="shrink-0 rounded-full bg-accent/20 px-2.5 py-1 text-2xs font-bold text-accent-text">
            {t("tile_live")}
          </span>
        ) : signedIn ? (
          <span
            className={cn(
              "num shrink-0 rounded-full px-2.5 py-1 text-xs",
              scored && pick.pts_total! > 0 ? "bg-good/15 text-good" : "bg-raised text-ink-3",
            )}
          >
            {scored ? t("plus_pts", { points: pick.pts_total! }) : t("tile_no_pick")}
          </span>
        ) : null}
      </header>

      {settled && (
        <Scoreboard
          title={t("row_result")}
          names={names}
          winner={side(match.winner_id)}
          sets={resultSets}
          n={resultSets.length}
          columns={columns}
          caption={t("row_result")}
          plain
        />
      )}
      {signedIn && pick && (
        <Scoreboard
          title={t("your_pick")}
          names={names}
          winner={side(pick.winner_id)}
          sets={pickSets}
          n={pickSets.length}
          columns={columns}
          marks={pick.exact_flags}
          caption={t("your_pick")}
          plain
        />
      )}

      {signedIn && <CrowdBlock match={match} pick={pick} short={short} />}

      {settled && match.status !== "completed" && (
        <p className="text-xs text-ink-3">
          {t(match.status === "retired" ? "void_note_retired" : "void_note_walkover")}
        </p>
      )}
      {settled && signedIn && scored && (
        <p className="text-xs text-ink-2">
          {/* 0018: a pick last changed once the match was really under way scores nothing */}
          {match.started_at && Date.parse(pick.updated_at) >= Date.parse(match.started_at)
            ? t("void_late", {
                time: localTime(match.started_at, event.timezone, locale),
              })
            : pick.pts_winner === 0
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

const pct = (share: number) => `${Number(share).toFixed(1)}%`;

/** How fans picked this match: share per player and the most picked score (totals, never names). */
function CrowdBlock({
  match,
  pick,
  short,
}: {
  match: Match;
  pick: Pick | undefined;
  short: (id: string | null) => string;
}) {
  const { t } = useT();
  const crowd = useQuery(crowdQuery(match.match_no)).data;
  if (!crowd) return null; // not started yet, or fewer picks than the minimum: no panel at all
  const top = crowd.top_score ?? [];
  const topWinner =
    top.filter((s) => s.p1_games > s.p2_games).length > top.length / 2 ? match.p1_id : match.p2_id;
  const side = (id: string | null, share: number) => (
    <span>
      <b>{short(id)}</b> {pct(share)}
      {pick?.winner_id === id && <span className="text-ink-3"> · {t("crowd_you")}</span>}
    </span>
  );
  return (
    <section className="space-y-1.5 border-t border-line pt-3" aria-label={t("crowd_title")}>
      <p className="text-2xs font-bold uppercase tracking-wider text-ink-3">{t("crowd_title")}</p>
      <div className="flex justify-between text-xs">
        {side(match.p1_id, crowd.p1_share)}
        {side(match.p2_id, crowd.p2_share)}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
        <span className="bg-accent" style={{ width: `${crowd.p1_share}%` }} />
        <span className="flex-1 bg-ink-3/50" />
      </div>
      {top.length > 0 && (
        <p className="text-xs text-ink-2">
          {t("crowd_top", {
            pick: `${short(topWinner)} · ${scoreLine(top)}`,
            share: pct(crowd.top_share),
          })}
        </p>
      )}
    </section>
  );
}
