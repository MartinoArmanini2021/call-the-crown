import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CallCardSheet } from "@/components/CallCard";
import { LeagueRankLine, OnboardSheet } from "@/components/LeagueNudge";
import { SponsorSlot } from "@/components/Brand";
import { MatchCard } from "@/components/MatchCard";
import { NextStepBanner } from "@/components/NextStep";
import { PickPager } from "@/components/PickPager";
import { PickSheet } from "@/components/PickSheet";
import { QueryGate } from "@/components/QueryGate";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import type { Match } from "@/lib/api";
import { matchState, shortTimeLeft } from "@/lib/format";
import { nextStep } from "@/lib/nextStep";

type Search = { match?: number };

export const Route = createFileRoute("/picks")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const n = Number(s["match"]);
    return Number.isInteger(n) && n > 0 ? { match: n } : {};
  },
  component: Picks,
});

// Only what you can do now: the matches you can pick, in the order they lock, one per screen (PickPager,
// 4 Oct 2026). The top is one short line (Tino, 4 Oct 2026: the match on screen straight away): the title
// with a link to How to play, then "1 of 2 picked · Next lock 1d 4h" above the match tabs. With nothing
// open, the next step (waiting for a result, or the event is over) is the content instead. The draw and finished matches live on Results (Tino, 2 Oct 2026).
// A pick is made in the sheet (PickSheet); a tap on an open match in the draw arrives here as ?match=N,
// opens it, and shows that match. After a save the pager moves on to the next match without a pick.
function Picks() {
  const { t, locale } = useT();
  const now = useServerNow();
  const navigate = useNavigate();
  const { user, matches, byPlayer, pickByMatch, queries } = useGame();
  const all = matches.data ?? [];
  const search = Route.useSearch();
  const [sheet, setSheet] = useState<number | null>(search.match ?? null);
  const close = useCallback(() => {
    setSheet(null);
    if (search.match) void navigate({ to: "/picks", search: {}, replace: true });
  }, [navigate, search.match]);
  const [saved, setSaved] = useState<{ pick: string; until: string; match?: number } | null>(null);
  // the My Call card opened from the saved toast (the toast itself goes after a few seconds)
  const [shareMatch, setShareMatch] = useState<number | null>(null);
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
  // The sheet needs a signed-in fan. If the session ends while it is open (it expired, or the fan
  // signed out in another tab), say the pick was not saved and offer the way back (audit 6 Oct 2026),
  // instead of the sheet vanishing with no word.
  const sheetOpen = Boolean(sheetMatch && user);
  const openWithUser = useRef(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    if (sheetOpen) openWithUser.current = true;
    else if (!user && openWithUser.current) setSessionEnded(true);
    if (!sheetOpen) openWithUser.current = false;
    if (user) setSessionEnded(false);
  }, [sheetOpen, user]);
  // which match the pager shows: a deep link, else the first one still without a pick
  const [focus, setFocus] = useState<number | undefined>(search.match);
  const firstTodo = open.find((m) => !pickByMatch.has(m.match_no))?.match_no;
  const pickedOpen = open.filter((m) => pickByMatch.has(m.match_no)).length;
  const shown = focus ?? firstTodo;
  const onSaved = (s: { pick: string; until: string }, savedMatch?: number) => {
    setSaved({ ...s, ...(savedMatch !== undefined ? { match: savedMatch } : {}) });
    const after = open.find((m) => m.match_no !== savedMatch && !pickByMatch.has(m.match_no));
    if (after) setFocus(after.match_no);
  };

  // which player the fan tapped on the card, if any: the sheet opens with that winner chosen
  const [startWith, setStartWith] = useState<1 | 2 | undefined>(undefined);
  const select = (m: Match, side?: 1 | 2) => {
    const state = matchState(m, now);
    if (state === "open") {
      setStartWith(side);
      if (user) setSheet(m.match_no);
      else void navigate({ to: "/sign-in", search: { redirect: "/picks" } });
    } else if (state === "settled" || state === "locked") {
      void navigate({ to: "/results" });
    }
  };

  return (
    <AppShell>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="headline text-4xl">{t("picks_title")}</h1>
        <Link
          to="/how-to-play"
          className="focus-ring shrink-0 rounded text-sm font-semibold text-ink-2 underline underline-offset-4"
        >
          {t("how_to_play")}
        </Link>
      </div>

      {user && <LeagueRankLine uid={user.id} matches={all} />}

      <QueryGate queries={queries} label={t("picks_title").toLowerCase()}>
        {open.length === 0 ? (
          user && step.kind !== "none" ? (
            <NextStepBanner step={step} matches={all} players={byPlayer} onPick={select} />
          ) : (
            <p className="card px-4 py-5 text-center text-sm text-ink-3">{t("nothing_open")}</p>
          )
        ) : (
          <PickPager
            matches={open}
            all={all}
            players={byPlayer}
            pickByMatch={pickByMatch}
            focus={shown}
            status={
              <p className="flex items-center justify-between gap-3">
                <span
                  className={pickedOpen === open.length ? "font-semibold text-good" : "text-ink-2"}
                >
                  {pickedOpen === open.length && "✓ "}
                  {t("picks_status", { n: pickedOpen, total: open.length })}
                </span>
                <span className="text-ink-3">
                  {t("next_lock")}{" "}
                  <b className="num text-accent-text">
                    {shortTimeLeft(Date.parse(open[0]!.starts_at!) - now, locale)}
                  </b>
                </span>
              </p>
            }
            render={(m) => (
              <MatchCard
                match={m}
                matches={all}
                players={byPlayer}
                pick={pickByMatch.get(m.match_no)}
                now={now}
                onPick={(side) => select(m, side)}
              />
            )}
          />
        )}
        <p className="mt-4 text-center text-sm">
          <Link to="/results" className="focus-ring font-semibold text-accent-text">
            {t("see_draw")} →
          </Link>
        </p>
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
          startWith={startWith}
          onClose={close}
          onSaved={(s) => onSaved(s, sheetMatch.match_no)}
        />
      )}

      {user && !sheetMatch && <OnboardSheet uid={user.id} />}

      {sessionEnded && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-20 z-30 mx-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-accent/45 bg-card px-4 py-3 text-sm shadow-lg"
        >
          <p className="font-bold text-accent-text">{t("session_ended")}</p>
          <Link
            to="/sign-in"
            search={{ redirect: "/picks" }}
            className="focus-ring mt-2 inline-block rounded-full bg-accent px-4 py-1.5 text-sm font-bold"
          >
            {t("sign_in")}
          </Link>
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-20 z-30 mx-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-good/45 bg-card px-4 py-3 text-sm shadow-lg"
        >
          <p className="font-bold text-good">✓ {t("saved_toast", { pick: saved.pick })}</p>
          <p className="mt-0.5 text-xs text-ink-2">{t("saved_toast_sub", { time: saved.until })}</p>
          {saved.match !== undefined && (
            <button
              type="button"
              onClick={() => {
                setShareMatch(saved.match!);
                setSaved(null);
              }}
              className="focus-ring mt-2 rounded-full border border-gold/50 px-4 py-1.5 text-xs font-bold text-gold"
            >
              {t("share_my_call")}
            </button>
          )}
        </div>
      )}
      {shareMatch !== null && (
        <CallCardSheet kind="my_call" matchNo={shareMatch} onClose={() => setShareMatch(null)} />
      )}
    </AppShell>
  );
}
