import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { MatchCard } from "@/components/MatchCard";
import { PickEditor } from "@/components/PickEditor";
import { QueryGate } from "@/components/QueryGate";
import { useEvent } from "@/config/eventConfig";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import { matchState, nightOf, shortTimeLeft } from "@/lib/format";

export const Route = createFileRoute("/picks")({ component: Picks });

function Picks() {
  const event = useEvent();
  const { t } = useT();
  const now = useServerNow();
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];

  const open = all.filter((m) => matchState(m, now) === "open");
  const picked = open.filter((m) => pickByMatch.has(m.match_no)).length;
  const nextLock = open.map((m) => Date.parse(m.starts_at!)).sort((a, b) => a - b)[0];
  const nights = [...new Set(all.map((m) => nightOf(m, all, event.timezone)))].sort();

  return (
    <AppShell>
      <PageTitle title={t("picks_title")} sub={t("picks_intro")} />

      {user && open.length > 0 && (
        <div className="card mb-5 flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
              {t("pick_complete", { n: picked, total: open.length })}
            </p>
            <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(picked / open.length) * 100}%` }}
              />
            </div>
          </div>
          {nextLock && (
            <div className="text-end">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                {t("next_lock")}
              </p>
              <p className="num text-xl text-accent-text">{shortTimeLeft(nextLock - now)}</p>
            </div>
          )}
        </div>
      )}

      {!user && (
        <Link
          to="/sign-in"
          className="focus-ring card mb-5 block px-4 py-3 text-sm font-semibold text-accent-text"
        >
          {t("sign_in")} →
        </Link>
      )}

      <QueryGate queries={queries} label={t("picks_title").toLowerCase()}>
        {nights.map((night) => (
          <section key={night} className="mb-6">
            {night > 0 && (
              <h2 className="headline mb-2 text-sm text-ink-3">
                {t(`night_${night}` as "night_1")}
              </h2>
            )}
            <div className="space-y-3">
              {all
                .filter((m) => nightOf(m, all, event.timezone) === night)
                .map((m) => (
                  <MatchCard
                    key={m.match_no}
                    match={m}
                    matches={all}
                    players={byPlayer}
                    pick={pickByMatch.get(m.match_no)}
                    now={now}
                    defaultOpen={!pickByMatch.has(m.match_no)}
                  >
                    {user && (
                      <PickEditor
                        key={`${m.p1_id}-${m.p2_id}`}
                        match={m}
                        pick={pickByMatch.get(m.match_no)}
                        players={byPlayer}
                        uid={user.id}
                      />
                    )}
                  </MatchCard>
                ))}
            </div>
          </section>
        ))}
        <SponsorSlot slot="picks_footer" />
      </QueryGate>
    </AppShell>
  );
}
