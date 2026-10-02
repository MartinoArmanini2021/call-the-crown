import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot, playerName } from "@/components/Brand";
import { Bracket } from "@/components/Bracket";
import { MatchCard } from "@/components/MatchCard";
import { NextStepBanner } from "@/components/NextStep";
import { PickSheet } from "@/components/PickSheet";
import { PicksIntro } from "@/components/PicksIntro";
import { QueryGate } from "@/components/QueryGate";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import type { Match } from "@/lib/api";
import { matchState, surname } from "@/lib/format";
import { nextStep } from "@/lib/nextStep";

export const Route = createFileRoute("/picks")({ component: Picks });

// The bracket on top (the whole event at a glance), then only the matches you can pick now, in the
// order they lock. Finished matches live on Results. A pick is made in the sheet (PickSheet).
function Picks() {
  const { t, locale } = useT();
  const now = useServerNow();
  const navigate = useNavigate();
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];
  const [sheet, setSheet] = useState<number | null>(null);
  const close = useCallback(() => setSheet(null), []);
  const [saved, setSaved] = useState<{ pick: string; until: string } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 6000);
    return () => clearTimeout(timer);
  }, [saved]);

  const open = all
    .filter((m) => matchState(m, now) === "open")
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!));
  const step = nextStep(all, new Set(pickByMatch.keys()), now);
  const sheetMatch = all.find((m) => m.match_no === sheet && matchState(m, now) === "open");

  const select = (m: Match) => {
    const state = matchState(m, now);
    if (state === "open") {
      if (user) setSheet(m.match_no);
      else void navigate({ to: "/sign-in", search: { redirect: "/picks" } });
    } else if (state === "settled" || state === "locked") {
      void navigate({ to: "/results" });
    }
  };

  return (
    <AppShell>
      <PageTitle title={t("picks_title")} sub={t("picks_intro")} />
      <PicksIntro />

      {user && matches.data && (
        <div className="mb-4">
          <NextStepBanner step={step} matches={all} onPick={select} />
        </div>
      )}

      {!user && (
        <Link
          to="/sign-in"
          className="focus-ring card mb-4 block px-4 py-3 text-sm font-semibold text-accent-text"
        >
          {t("sign_in")} →
        </Link>
      )}

      <QueryGate queries={queries} label={t("picks_title").toLowerCase()}>
        <Bracket
          matches={all}
          players={byPlayer}
          pickByMatch={pickByMatch}
          now={now}
          onSelect={select}
        />
        <p className="mt-2 text-center text-[11px] text-ink-3">{t("bracket_hint")}</p>

        <h2 className="headline mb-2 mt-6 text-sm text-ink-3">{t("open_now")}</h2>
        {open.length === 0 ? (
          <p className="card px-4 py-5 text-center text-sm text-ink-3">{t("nothing_open")}</p>
        ) : (
          <div className="space-y-3">
            {open.map((m) => {
              const pick = pickByMatch.get(m.match_no);
              return (
                <MatchCard
                  key={m.match_no}
                  match={m}
                  matches={all}
                  players={byPlayer}
                  pick={pick}
                  now={now}
                  action={
                    <button
                      type="button"
                      onClick={() => select(m)}
                      className={
                        pick
                          ? "focus-ring num rounded-full bg-raised px-3 py-1.5 font-semibold"
                          : "focus-ring rounded-full bg-accent px-4 py-1.5 font-bold"
                      }
                    >
                      {pick
                        ? `✓ ${t("pick_summary", { name: surname(playerName(byPlayer.get(pick.winner_id), locale)), n: pick.sets })} · ${t("edit_pick")}`
                        : t("make_pick")}
                    </button>
                  }
                />
              );
            })}
          </div>
        )}
        <SponsorSlot slot="picks_footer" className="mt-6" />
      </QueryGate>

      {sheetMatch && user && (
        <PickSheet
          key={sheetMatch.match_no}
          match={sheetMatch}
          matches={all}
          pick={pickByMatch.get(sheetMatch.match_no)}
          players={byPlayer}
          uid={user.id}
          now={now}
          onClose={close}
          onSaved={setSaved}
        />
      )}

      {saved && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-20 z-30 mx-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-good/45 bg-card px-4 py-3 text-sm shadow-lg"
        >
          <p className="font-bold text-good">✓ {t("saved_toast", { pick: saved.pick })}</p>
          <p className="mt-0.5 text-xs text-ink-2">{t("saved_toast_sub", { time: saved.until })}</p>
        </div>
      )}
    </AppShell>
  );
}
