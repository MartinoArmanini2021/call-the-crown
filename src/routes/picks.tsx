import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SponsorSlot } from "@/components/Brand";
import { MatchCard } from "@/components/MatchCard";
import { NextStepBanner } from "@/components/NextStep";
import { PickPager } from "@/components/PickPager";
import { PickSheet } from "@/components/PickSheet";
import { PicksIntro } from "@/components/PicksIntro";
import { QueryGate } from "@/components/QueryGate";
import { useGame } from "@/hooks/useGame";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import type { Match } from "@/lib/api";
import { matchState } from "@/lib/format";
import { nextStep } from "@/lib/nextStep";

type Search = { match?: number };

export const Route = createFileRoute("/picks")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const n = Number(s["match"]);
    return Number.isInteger(n) && n > 0 ? { match: n } : {};
  },
  component: Picks,
});

// Only what you can do now: the next step, then the matches you can pick, in the order they lock, one
// per screen (PickPager, 4 Oct 2026). The draw and finished matches live on Results (Tino, 2 Oct 2026).
// A pick is made in the sheet (PickSheet); a tap on an open match in the draw arrives here as ?match=N,
// opens it, and shows that match. After a save the pager moves on to the next match without a pick.
function Picks() {
  const { t } = useT();
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
  // which match the pager shows: a deep link, else the first one still without a pick
  const [focus, setFocus] = useState<number | undefined>(search.match);
  const firstTodo = open.find((m) => !pickByMatch.has(m.match_no))?.match_no;
  const shown = focus ?? firstTodo;
  const onSaved = (s: { pick: string; until: string }, savedMatch?: number) => {
    setSaved(s);
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
      <PageTitle title={t("picks_title")} sub={t("picks_intro")} />
      <PicksIntro />

      {user && matches.data && (
        <div className="mb-4">
          <NextStepBanner step={step} matches={all} players={byPlayer} onPick={select} />
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
        <h2 className="headline mb-2 text-sm text-ink-3">{t("open_now")}</h2>
        {open.length === 0 ? (
          <p className="card px-4 py-5 text-center text-sm text-ink-3">{t("nothing_open")}</p>
        ) : (
          <PickPager
            matches={open}
            all={all}
            players={byPlayer}
            pickByMatch={pickByMatch}
            focus={shown}
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
