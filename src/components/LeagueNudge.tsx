// Leagues first (brief "bragging rights", Phase 2), the two pieces on Picks:
//   - LeagueRankLine: "#3 of 8 in Office Crew" for the active league (the last one created, joined or
//     looked at on Standings, else the newest), the empty-table line before the first result, and the
//     alone nudge with Invite while the league is only the fan;
//   - OnboardSheet: the one-time "Who are you playing against?" step for a fan with no league.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import {
  leaderboardQuery,
  myLeaguesQuery,
  rankWindowQuery,
  type League,
  type Match,
} from "@/lib/api";
import {
  getActiveLeague,
  markOnboardSeen,
  onboardSeen,
  peekPendingJoin,
  shareInvite,
} from "@/lib/leagueIntent";

/** The fan's active league: the one stored for this device, else the newest. */
export function activeLeague(uid: string, list: League[]): League | undefined {
  const stored = getActiveLeague(uid);
  return list.find((l) => l.id === stored) ?? list[list.length - 1];
}

export function LeagueRankLine({ uid, matches }: { uid: string; matches: Match[] }) {
  const { t } = useT();
  const leagues = useQuery(myLeaguesQuery(uid));
  const league = activeLeague(uid, leagues.data ?? []);
  const id = league?.id ?? null;
  const mine = useQuery({ ...rankWindowQuery(id), enabled: !!league });
  const size = useQuery({ ...leaderboardQuery(id, 0, 1), enabled: !!league });
  const [copied, setCopied] = useState(false);
  if (!league) return null;

  const started = matches.some((m) => m.status !== "scheduled");
  const me = mine.data?.find((r) => r.is_me);
  const n = size.data?.[0]?.total;
  const alone = league.member_count === 1;

  async function invite() {
    if (league && (await shareInvite(league)) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section className="card mb-3 px-4 py-3 text-sm">
      <Link
        to="/standings"
        search={{ league: league.id }}
        className="focus-ring block rounded font-semibold"
      >
        {started && me && n !== undefined ? (
          t("league_rank_line", { rank: me.pos, n, league: league.name })
        ) : (
          <>
            <span className="text-ink">{league.name}</span>
            {!started && <span className="font-normal text-ink-3"> · {t("board_empty")}</span>}
          </>
        )}
      </Link>
      {alone && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-2">{t("league_alone_nudge")}</p>
          <button
            type="button"
            onClick={invite}
            className="focus-ring shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-bold"
          >
            {copied ? t("invite_copied") : t("invite")}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Shown once per fan (remembered on this device), only to a fan with no league and no invite on the way.
 * It counts as seen the moment it shows, so "Not now", a tap outside, or leaving all end it for good.
 */
export function OnboardSheet({ uid }: { uid: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const leagues = useQuery(myLeaguesQuery(uid));
  const [show, setShow] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!leagues.isSuccess || leagues.data.length > 0) return;
    if (peekPendingJoin() || onboardSeen(uid)) return;
    markOnboardSeen(uid);
    setShow(true);
  }, [uid, leagues.isSuccess, leagues.data]);

  useEffect(() => {
    if (!show) return;
    panel.current?.querySelector<HTMLElement>("button[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShow(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;
  const go = (add: "create" | "join") => {
    setShow(false);
    void navigate({ to: "/standings", search: { add } });
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={() => setShow(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        className="safe-bottom relative w-full max-w-xl space-y-4 rounded-t-3xl border-t border-line bg-card px-4 pb-4 pt-5"
      >
        <h2 id="onboard-title" className="headline text-2xl">
          {t("onboard_title")}
        </h2>
        <p className="text-sm text-ink-2">{t("onboard_sub")}</p>
        <div className="flex gap-2">
          <button
            type="button"
            data-autofocus=""
            onClick={() => go("create")}
            className="focus-ring h-11 flex-1 rounded-full bg-accent text-sm font-bold"
          >
            {t("create")}
          </button>
          <button
            type="button"
            onClick={() => go("join")}
            className="focus-ring h-11 flex-1 rounded-full bg-raised text-sm font-semibold"
          >
            {t("join")}
          </button>
        </div>
        <p className="text-center">
          <button
            type="button"
            onClick={() => setShow(false)}
            className="focus-ring rounded text-xs text-ink-2 underline underline-offset-2"
          >
            {t("not_now")}
          </button>
        </p>
      </div>
    </div>
  );
}
