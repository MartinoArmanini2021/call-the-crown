// Crews (brief "bragging rights", Phase 4): friends leagues against each other, on Standings. Leagues
// of 5+ members, ranked by the average points of their best 5 (get_crew_board, 0021: the server
// decides who is in and never sends a member count of anyone else's league). The fan sees the rule,
// their own crews' places, the top 10, their crews below it, and, for each of their leagues still
// short of 5, how many more members it needs with an Invite button. Once the final is settled, the
// leader is the "Crowned crew".
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useT } from "@/i18n/useT";
import { crewBoardQuery, matchesQuery, type CrewRow, type League } from "@/lib/api";
import { isolate } from "@/lib/format";
import { shareInvite } from "@/lib/leagueIntent";
import { cn } from "@/lib/utils";
import { MEDAL } from "./Brand";
import { QueryGate } from "./QueryGate";

const TOP = 10;
const MIN = 5;

export function CrewsBoard({ leagues }: { leagues: League[] }) {
  const { t } = useT();
  const board = useQuery(crewBoardQuery());
  const matches = useQuery(matchesQuery);
  const rows = board.data ?? [];
  const finalDone = (matches.data ?? []).some((m) => m.round === "F" && m.status !== "scheduled");
  const top = rows.filter((r) => r.rank <= TOP);
  const below = rows.filter((r) => r.rank > TOP);
  const mine = rows.filter((r) => r.is_mine);
  const short = leagues.filter((l) => l.member_count < MIN);

  return (
    <section aria-labelledby="crews-title">
      <h2 id="crews-title" className="headline text-2xl">
        {t("crews_title")}
      </h2>
      <p className="mt-1 text-xs text-ink-3">{t("crews_rule")}</p>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {mine.map((r) => (
            <li key={r.league_id} className="font-semibold">
              <bdi className="text-ink">{r.name}</bdi>
              <span className="text-gold"> · {t("crews_yours", { rank: r.rank })}</span>
            </li>
          ))}
        </ul>
      )}

      {short.length > 0 && (
        <ul className="mt-3 space-y-2">
          {short.map((l) => (
            <NeedsMore key={l.id} league={l} />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <QueryGate queries={[board]} label={t("crews_title").toLowerCase()}>
          {rows.length === 0 ? (
            <p className="card px-4 py-6 text-center text-sm text-ink-3">{t("crews_empty")}</p>
          ) : (
            <>
              <CrewList rows={top} crowned={finalDone} />
              {below.length > 0 && (
                <>
                  <p aria-hidden className="py-1 text-center text-ink-3">
                    ⋯
                  </p>
                  <CrewList rows={below} crowned={false} />
                </>
              )}
            </>
          )}
        </QueryGate>
      </div>
    </section>
  );
}

function CrewList({ rows, crowned }: { rows: CrewRow[]; crowned: boolean }) {
  const { t } = useT();
  return (
    <ol className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.league_id}
          className={cn(
            "card flex items-center gap-3 px-4 py-3",
            r.is_mine && "ring-1 ring-inset ring-gold/70",
          )}
        >
          <span
            className={cn(
              "num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
              r.rank <= 3 ? `${MEDAL[r.rank - 1]} text-bg` : "bg-raised text-ink-2",
            )}
          >
            {r.rank}
          </span>
          <span className="min-w-0 flex-1">
            <bdi className="block truncate font-semibold">{r.name}</bdi>
            {crowned && r.rank === 1 && (
              <span className="mt-0.5 inline-block rounded-full bg-gold/15 px-2 py-0.5 text-2xs font-bold text-gold">
                ♛ {t("crew_crowned")}
              </span>
            )}
          </span>
          <span className="num shrink-0 text-base">{Number(r.avg_points).toFixed(1)}</span>
        </li>
      ))}
    </ol>
  );
}

function NeedsMore({ league }: { league: League }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const n = MIN - league.member_count;
  const text =
    n === 1
      ? t("crews_needs_1", { league: isolate(league.name) })
      : n === 2
        ? t("crews_needs_2", { league: isolate(league.name) })
        : t("crews_needs", { league: isolate(league.name), n });
  return (
    <li className="card flex items-center justify-between gap-3 px-4 py-3">
      <p className="text-xs text-ink-2">{text}</p>
      <button
        type="button"
        onClick={async () => {
          if ((await shareInvite(league)) === "copied") {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
        className="focus-ring shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-bold"
      >
        {copied ? t("invite_copied") : t("invite")}
      </button>
    </li>
  );
}
