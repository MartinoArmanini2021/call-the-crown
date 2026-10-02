import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { NextStepBanner } from "@/components/NextStep";
import { QueryGate } from "@/components/QueryGate";
import { ResultCard } from "@/components/ResultCard";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import { leaderboardQuery, rankWindowQuery } from "@/lib/api";
import { matchState } from "@/lib/format";
import { nextStep } from "@/lib/nextStep";

export const Route = createFileRoute("/results")({ component: Results });

// Where you stand first (points, rank among all fans, matches scored), then every finished or
// in-play match, latest first, with your pick set by set against the result.
function Results() {
  const { t } = useT();
  const now = useServerNow(30_000);
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];
  const shown = all
    .filter((m) => ["settled", "locked"].includes(matchState(m, now)))
    .sort((a, b) => Date.parse(b.starts_at ?? "") - Date.parse(a.starts_at ?? ""));
  const settledCount = all.filter((m) => m.status !== "scheduled").length;

  const rankWindow = useQuery({ ...rankWindowQuery(null), enabled: !!user });
  const head = useQuery({ ...leaderboardQuery(null, 0, 1), enabled: !!user });
  const me = rankWindow.data?.find((r) => r.is_me);
  const ranked = head.data?.[0]?.total ?? null;
  const points = [...pickByMatch.values()].reduce((sum, p) => sum + (p.pts_total ?? 0), 0);

  return (
    <AppShell>
      <PageTitle title={t("results_title")} />
      <QueryGate queries={queries} label={t("results_title").toLowerCase()}>
        {user && settledCount > 0 && (
          <div className="mb-5 grid grid-cols-3 gap-2">
            <Stat label={t("stat_points")} value={String(points)} accent />
            <Stat
              label={t("stat_rank")}
              value={me?.global_rank ? String(me.global_rank) : "–"}
              of={ranked ? ranked.toLocaleString("en-GB") : null}
            />
            <Stat label={t("stat_scored")} value={String(settledCount)} of={String(all.length)} />
          </div>
        )}
        {shown.length === 0 ? (
          <p className="card px-4 py-6 text-center text-sm text-ink-3">{t("results_empty")}</p>
        ) : (
          <div className="space-y-3">
            {shown.map((m, i) => (
              <div key={m.match_no} className="space-y-3">
                <ResultCard
                  match={m}
                  matches={all}
                  pick={pickByMatch.get(m.match_no)}
                  players={byPlayer}
                  signedIn={!!user}
                />
                {i === 0 && <SponsorSlot slot="results_card" />}
              </div>
            ))}
          </div>
        )}
        {user && (
          <div className="mt-5">
            <NextStepBanner step={nextStep(all, new Set(pickByMatch.keys()), now)} matches={all} />
          </div>
        )}
      </QueryGate>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  of = null,
  accent = false,
}: {
  label: string;
  value: string;
  of?: string | null;
  accent?: boolean;
}) {
  return (
    <div className="card px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={accent ? "num text-2xl text-accent-text" : "num text-2xl"}>
        {value}
        {of && <span className="text-xs font-semibold text-ink-3"> /{of}</span>}
      </p>
    </div>
  );
}
