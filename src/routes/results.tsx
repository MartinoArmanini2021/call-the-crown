import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { MatchCard } from "@/components/MatchCard";
import { PointsBreakdown } from "@/components/PointsBreakdown";
import { QueryGate } from "@/components/QueryGate";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import { matchState } from "@/lib/format";

export const Route = createFileRoute("/results")({ component: Results });

function Results() {
  const { t } = useT();
  const now = useServerNow(30_000);
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];
  // Latest first: settled matches, and matches in play waiting for their result.
  const shown = all.filter((m) => ["settled", "locked"].includes(matchState(m, now))).reverse();
  const total = [...pickByMatch.values()].reduce((sum, p) => sum + (p.pts_total ?? 0), 0);

  return (
    <AppShell>
      <PageTitle title={t("results_title")} />
      <QueryGate queries={queries} label={t("results_title").toLowerCase()}>
        {user && shown.length > 0 && (
          <div className="card mb-5 flex items-baseline justify-between px-4 py-3">
            <span className="text-sm font-semibold text-ink-2">{t("points")}</span>
            <span className="num text-3xl text-accent-text">{total}</span>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="card px-4 py-6 text-center text-sm text-ink-3">{t("results_empty")}</p>
        ) : (
          <div className="space-y-3">
            {shown.map((m, i) => (
              <div key={m.match_no}>
                <MatchCard
                  match={m}
                  matches={all}
                  players={byPlayer}
                  pick={pickByMatch.get(m.match_no)}
                  now={now}
                />
                {user && m.status !== "scheduled" && (
                  <div className="card -mt-3 rounded-t-none border-t-0 px-4 pb-4">
                    <PointsBreakdown match={m} pick={pickByMatch.get(m.match_no)} />
                  </div>
                )}
                {i === 0 && <SponsorSlot slot="results_card" className="mt-3" />}
              </div>
            ))}
          </div>
        )}
      </QueryGate>
    </AppShell>
  );
}
