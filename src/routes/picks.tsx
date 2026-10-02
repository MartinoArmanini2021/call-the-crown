import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { Bracket } from "@/components/Bracket";
import { MatchCard } from "@/components/MatchCard";
import { PickSheet } from "@/components/PickSheet";
import { QueryGate } from "@/components/QueryGate";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import type { Match } from "@/lib/api";
import { matchState, scoreLine, shortTimeLeft } from "@/lib/format";

export const Route = createFileRoute("/picks")({ component: Picks });

// The bracket on top (the whole event at a glance), then only the matches you can pick now, in the
// order they lock. Finished matches live on Results. A pick is made in the sheet (PickSheet).
function Picks() {
  const { t } = useT();
  const now = useServerNow();
  const navigate = useNavigate();
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];
  const [sheet, setSheet] = useState<number | null>(null);
  const close = useCallback(() => setSheet(null), []);

  const open = all
    .filter((m) => matchState(m, now) === "open")
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!));
  const picked = open.filter((m) => pickByMatch.has(m.match_no)).length;
  const nextLock = open[0]?.starts_at ? Date.parse(open[0].starts_at) - now : null;
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

      {user && open.length > 0 && (
        <div className="card mb-4 flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
              {t("your_picks_open", { n: picked, total: open.length })}
            </p>
            <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(picked / open.length) * 100}%` }}
              />
            </div>
          </div>
          {nextLock !== null && (
            <div className="text-end">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                {t("next_lock")}
              </p>
              <p className="num text-xl text-accent-text">{shortTimeLeft(nextLock)}</p>
            </div>
          )}
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
                      {pick ? `${t("edit_pick")} · ${scoreLine(pick.set_scores)}` : t("make_pick")}
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
        />
      )}
    </AppShell>
  );
}
