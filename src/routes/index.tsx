import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SponsorSlot, playerName } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useServerNow } from "@/hooks/useNow";
import { LANGUAGE_NAMES } from "@/i18n/strings";
import { groupsInOrder, useGroupColor } from "@/components/groupColors";
import { useT } from "@/i18n/useT";
import {
  inLocale,
  matchesQuery,
  myLeaguesQuery,
  playersQuery,
  publicImage,
  type Player,
} from "@/lib/api";
import { shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Landing });

// The front door leads with the event: where and when, the six players, how long until the first
// picks close (all from config and the bracket; nothing hard-coded). Since 13 Nov 2026 one short line
// and no scoring example ("there is a lot of text"): How to play has it.
function Landing() {
  const event = useEvent();
  const { t, locale, languages, setLocale } = useT();
  const { user } = useAuth();
  const now = useServerNow();
  const players = useQuery(playersQuery);
  const matches = useQuery(matchesQuery);
  const leagues = useQuery({ ...myLeaguesQuery(user?.id ?? ""), enabled: !!user });
  const noLeague = !!user && leagues.isSuccess && leagues.data.length === 0;

  const firstLock = (matches.data ?? [])
    .filter((m) => m.status === "scheduled" && m.p1_id && m.p2_id && m.starts_at)
    .map((m) => Date.parse(m.starts_at!))
    .filter((ms) => ms > now)
    .sort((a, b) => a - b)[0];

  const firstBall = (matches.data ?? [])
    .map((m) => (m.starts_at ? Date.parse(m.starts_at) : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  const voteOpen = matches.isSuccess && (firstBall === Infinity || firstBall > now);

  const count = (matches.data ?? []).length;
  // Round robin: each player's group, for the tiles' order and colour (13 Nov 2026)
  const groupColor = useGroupColor(matches.data ?? []);
  const groupOrder = groupsInOrder(matches.data ?? []);
  const groupOf = new Map<string, string>();
  for (const m of matches.data ?? [])
    if (m.round === "RR" && m.grp)
      for (const id of [m.p1_id, m.p2_id]) if (id) groupOf.set(id, m.grp);
  const groupRank = (id: string) => {
    const g = groupOf.get(id);
    return g ? groupOrder.indexOf(g) : 99;
  };

  const primary =
    "focus-ring inline-flex h-12 items-center rounded-full bg-accent px-7 text-sm font-bold shadow-[0_8px_30px_-8px_var(--accent)]";
  const secondary =
    "focus-ring inline-flex h-12 items-center rounded-full border border-line bg-raised/70 px-6 text-sm font-semibold";

  const countdown =
    firstLock !== undefined ? (
      <span className="flex flex-col leading-tight">
        <span className="text-2xs text-ink-2">{t("first_lock_short")}</span>
        <span className="num whitespace-nowrap text-2xl text-accent-text">
          {shortTimeLeft(firstLock - now, locale)}
        </span>
      </span>
    ) : null;

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_80%_at_100%_0%,color-mix(in_srgb,var(--accent)_45%,transparent),transparent_60%),linear-gradient(160deg,color-mix(in_srgb,var(--accent-deep)_40%,var(--bg)),var(--bg)_70%)] px-5 pb-6 pt-7">
        {inLocale(event.branding, "event_line", locale) && (
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-ink-2">
            {inLocale(event.branding, "event_line", locale)}
          </p>
        )}
        <h1 className="headline mt-3 text-6xl sm:text-7xl">{t("landing_title")}</h1>
        {/* one line, not a paragraph (Tino, 13 Nov 2026: "there is a lot of text"); the scoring
            example lives on How to play */}
        <p className="mt-2 text-base font-semibold text-ink">
          {t("landing_one_line", { n: count || 6 })}
        </p>

        {/* Leagues first (brief "bragging rights", Phase 2): the game is beating your friends. The
            buttons sit above the players (UX review, 13 Nov 2026): a friend arriving from a WhatsApp
            link sees what to do on the first screen of a phone, without scrolling. */}
        {/* The countdown sits beside the main button, on its line (Tino, 13 Nov 2026: "less free
            space"): a short label over the time, which never breaks inside itself. */}
        {user ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link to="/picks" className={primary}>
              {t("landing_cta_signed_in")}
            </Link>
            {countdown}
            {noLeague && (
              <Link to="/standings" search={{ add: "create" }} className={secondary}>
                {t("cta_start_league")}
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                to="/sign-in"
                search={{ redirect: "/standings?add=create" }}
                className={primary}
              >
                {t("cta_start_league")}
              </Link>
              {countdown}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to="/sign-in"
                search={{ redirect: "/standings?add=join" }}
                className={secondary}
              >
                {t("cta_join_code")}
              </Link>
            </div>
            <Link
              to="/sign-in"
              className="focus-ring mt-1 inline-flex min-h-11 items-center rounded text-sm text-ink-2 underline underline-offset-4"
            >
              {t("cta_solo")}
            </Link>
          </>
        )}

        {(players.data ?? []).length > 0 && (
          <ul
            className={cn(
              "mt-5 grid gap-2",
              (players.data ?? []).length % 4 === 0 ? "grid-cols-4" : "grid-cols-3",
            )}
            aria-label={t("landing_players")}
          >
            {[...(players.data ?? [])]
              .sort((a, b) => groupRank(a.id) - groupRank(b.id) || (a.seed ?? 99) - (b.seed ?? 99))
              .map((p) => (
                <li key={p.id}>
                  <Portrait
                    player={p}
                    name={playerName(p, locale)}
                    dense={(players.data ?? []).length % 4 === 0}
                    color={groupColor(groupOf.get(p.id))}
                  />
                </li>
              ))}
          </ul>
        )}

        {/* the quick vote closes at the first ball: no link to a closed vote */}
        {voteOpen && (
          <Link
            to="/vote"
            className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold"
          >
            {t("landing_vote_link")} <span aria-hidden>{locale === "ar" ? "←" : "→"}</span>
          </Link>
        )}
      </section>

      <SponsorSlot slot="landing_strip" className="mt-4" />

      <p className="mt-6 flex justify-center gap-4 text-center text-xs text-ink-3">
        <Link to="/how-to-play" className="focus-ring underline underline-offset-2">
          {t("how_to_play")}
        </Link>
        {languages
          .filter((l) => l !== locale)
          .map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className="focus-ring underline underline-offset-2"
              lang={l}
            >
              {LANGUAGE_NAMES[l]}
            </button>
          ))}
      </p>
    </AppShell>
  );
}

/** A player as a tile with their name: the organiser's photo behind it once photos arrive. */
/** dense: eight players, four to a row (ATP Finals): a taller tile, the surname only. */
function Portrait({
  player,
  name,
  dense = false,
  color,
}: {
  player: Player;
  name: string;
  dense?: boolean;
  /** the player's group colour (round robin), as a bar along the tile's foot */
  color?: string | undefined;
}) {
  // A photo that will not load (ATP stopped serving its headshots to other sites, Oct 2026) leaves the
  // name alone in the tile, never a broken-image icon.
  const [failed, setFailed] = useState(false);
  const img = failed ? undefined : publicImage(player.image_path);
  const last = surname(name);
  const first = name.slice(0, name.length - last.length).trim();
  return (
    <div
      className={cn(
        "relative flex flex-col justify-end overflow-hidden rounded-lg border border-line bg-gradient-to-b from-raised to-card pb-1.5",
        dense ? "aspect-[3/4] px-1.5" : "aspect-[4/3] px-2",
      )}
      title={name}
    >
      {img && (
        <>
          <img
            src={img}
            alt=""
            // like every other headshot (PlayerPhoto, vote): without it atptour.com refuses the
            // image and the landing tiles showed names only
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        </>
      )}
      {color && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1"
          style={{ background: color }}
        />
      )}
      {first && !dense && <span className="relative truncate text-2xs text-ink-2">{first}</span>}
      <span
        className={cn(
          "headline relative pb-0.5 leading-snug text-ink",
          dense ? "truncate text-sm sm:text-base" : "line-clamp-2 break-words text-base sm:text-lg",
        )}
      >
        {last}
      </span>
    </div>
  );
}
