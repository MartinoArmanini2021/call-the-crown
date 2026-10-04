import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { Draw } from "@/components/Draw";
import { NextStepBanner } from "@/components/NextStep";
import { QueryGate } from "@/components/QueryGate";
import { ResultSheet } from "@/components/ResultSheet";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import { leaderboardQuery, rankWindowQuery, type Match } from "@/lib/api";
import { matchState } from "@/lib/format";
import { nextStep } from "@/lib/nextStep";

export const Route = createFileRoute("/results")({ component: Results });

// Where you stand first (points, rank among all fans, matches played), then the draw (the whole
// event at a glance). A finished or in-play match opens from its card in the draw, as a sheet with your
// pick set by set against the result (Tino, 4 Oct 2026: no second list of the same matches below).
function Results() {
  const { t } = useT();
  const now = useServerNow(30_000);
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const navigate = useNavigate();
  const selectInDraw = (m: Match) => {
    const state = matchState(m, now);
    if (state === "open") {
      void (user
        ? navigate({ to: "/picks", search: { match: m.match_no } })
        : navigate({ to: "/sign-in", search: { redirect: "/picks" } }));
    } else if (state === "settled" || state === "locked") {
      setOpen(m.match_no);
    }
  };
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const all = matches.data ?? [];
  const openMatch = all.find((m) => m.match_no === open);
  const settledCount = all.filter((m) => m.status !== "scheduled").length;

  const rankWindow = useQuery({ ...rankWindowQuery(null), enabled: !!user });
  const head = useQuery({ ...leaderboardQuery(null, 0, 1), enabled: !!user });
  const me = rankWindow.data?.find((r) => r.is_me);
  const ranked = head.data?.[0]?.total ?? null;
  const points = [...pickByMatch.values()].reduce((sum, p) => sum + (p.pts_total ?? 0), 0);

  return (
    <AppShell wide>
      <PageTitle title={t("results_title")} />
      <QueryGate queries={queries} label={t("results_title").toLowerCase()}>
        {user && settledCount > 0 && (
          <div className="mb-5 grid grid-cols-3 gap-2">
            <Stat label={t("stat_points")} value={String(points)} accent />
            <Stat
              label={t("stat_rank")}
              value={me?.global_rank ? String(me.global_rank) : "–"}
              of={me?.global_rank && ranked ? ranked.toLocaleString("en-GB") : null}
            />
            <Stat label={t("stat_scored")} value={String(settledCount)} of={String(all.length)} />
          </div>
        )}
        <section className="mb-6" aria-labelledby="draw-title">
          <h2 id="draw-title" className="headline mb-3 text-2xl">
            {t("draw_title")}
          </h2>
          <Draw
            matches={all}
            players={byPlayer}
            pickByMatch={pickByMatch}
            now={now}
            onSelect={selectInDraw}
          />
          <p className="mt-2 text-center text-2xs text-ink-3">{t("draw_hint")}</p>
        </section>

        <SponsorSlot slot="results_card" />
        {user && (
          <div className="mt-5">
            <NextStepBanner
              step={nextStep(all, new Set(pickByMatch.keys()), now)}
              matches={all}
              players={byPlayer}
            />
          </div>
        )}
      </QueryGate>
      {openMatch && (
        <ResultSheet
          match={openMatch}
          matches={all}
          pick={pickByMatch.get(openMatch.match_no)}
          players={byPlayer}
          signedIn={!!user}
          onClose={close}
        />
      )}
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
  const { t } = useT();
  return (
    <div className="card px-3 py-2.5">
      <p className="text-2xs font-bold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={accent ? "num text-2xl text-accent-text" : "num text-2xl"}>
        {value}
        {of && <span className="text-xs font-semibold text-ink-3"> {t("stat_of", { n: of })}</span>}
      </p>
    </div>
  );
}
