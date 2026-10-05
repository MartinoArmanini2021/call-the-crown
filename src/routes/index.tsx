import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SponsorSlot, playerName } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useServerNow } from "@/hooks/useNow";
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

export const Route = createFileRoute("/")({ component: Landing });

// The front door leads with the event: where and when, the six players, how long until the first
// picks close, and a worked example of how a pick scores (all from config and the bracket; nothing
// hard-coded). First-time-fan test, 2 Oct 2026: one plain sentence and one example beat three tiles.
function Landing() {
  const event = useEvent();
  const { t, locale, setLocale } = useT();
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

  const count = (matches.data ?? []).length;
  // the example is a quarter-final pick, so it names a quarter-final player
  const qf = (matches.data ?? []).find((m) => m.round === "QF" && m.p1_id);
  const top = (players.data ?? []).find((p) => p.id === qf?.p1_id);

  const primary =
    "focus-ring inline-flex h-12 items-center rounded-full bg-accent px-7 text-sm font-bold shadow-[0_8px_30px_-8px_var(--accent)]";
  const secondary =
    "focus-ring inline-flex h-12 items-center rounded-full border border-line bg-raised/70 px-6 text-sm font-semibold";

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_80%_at_100%_0%,rgb(229_9_20/0.45),transparent_60%),linear-gradient(160deg,#1d0a0b,var(--bg)_70%)] px-5 pb-6 pt-7">
        {inLocale(event.branding, "event_line", locale) && (
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-ink-2">
            {inLocale(event.branding, "event_line", locale)}
          </p>
        )}
        <h1 className="headline mt-3 text-6xl sm:text-7xl">{t("landing_title")}</h1>
        <p className="mt-2 text-base font-semibold text-ink">{t("landing_league_line")}</p>
        <p className="mt-2 max-w-md text-sm text-ink-2">
          {t("landing_sentence", { n: count || 6 })}
        </p>

        {(players.data ?? []).length > 0 && (
          <ul className="mt-5 grid grid-cols-3 gap-2" aria-label={t("landing_players")}>
            {[...(players.data ?? [])]
              .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99))
              .map((p) => (
                <li key={p.id}>
                  <Portrait player={p} name={playerName(p, locale)} />
                </li>
              ))}
          </ul>
        )}

        {firstLock !== undefined && (
          <p className="mt-5 flex items-baseline gap-2">
            <span className="text-xs text-ink-2">{t("first_lock_in")}</span>
            <span className="num text-3xl text-accent-text">
              {shortTimeLeft(firstLock - now, locale)}
            </span>
          </p>
        )}

        {/* Leagues first (brief "bragging rights", Phase 2): the game is beating your friends. */}
        {user ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/picks" className={primary}>
              {t("landing_cta_signed_in")}
            </Link>
            {noLeague && (
              <Link to="/standings" search={{ add: "create" }} className={secondary}>
                {t("cta_start_league")}
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/sign-in"
                search={{ redirect: "/standings?add=create" }}
                className={primary}
              >
                {t("cta_start_league")}
              </Link>
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
              className="focus-ring mt-3 inline-block rounded text-sm text-ink-2 underline underline-offset-4"
            >
              {t("cta_solo")}
            </Link>
          </>
        )}
      </section>

      <ScoringExample name={top ? surname(playerName(top, locale)) : t("example_player")} />

      <SponsorSlot slot="landing_strip" className="mt-4" />

      <p className="mt-6 flex justify-center gap-4 text-center text-xs text-ink-3">
        <Link to="/how-to-play" className="focus-ring underline underline-offset-2">
          {t("how_to_play")}
        </Link>
        {event.flags.arabic && (
          <button
            type="button"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="focus-ring underline underline-offset-2"
            lang={locale === "ar" ? "en" : "ar"}
          >
            {locale === "ar" ? "English" : "العربية"}
          </button>
        )}
      </p>
    </AppShell>
  );
}

/** A player as a tile with their name: the organiser's photo behind it once photos arrive. */
function Portrait({ player, name }: { player: Player; name: string }) {
  const img = publicImage(player.image_path);
  const last = surname(name);
  const first = name.slice(0, name.length - last.length).trim();
  return (
    <div
      className="relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg border border-line bg-gradient-to-b from-raised to-card px-2 pb-1.5"
      title={name}
    >
      {img && (
        <>
          <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        </>
      )}
      {first && <span className="relative truncate text-2xs text-ink-2">{first}</span>}
      <span className="headline relative line-clamp-2 break-words pb-0.5 text-base leading-snug text-ink sm:text-lg">
        {last}
      </span>
    </div>
  );
}

/**
 * How a pick scores, worked through once: a quarter-final pick of 6-4 6-3 against a 6-4 7-5 result.
 * The points are read from the rules (winner, sets, per exact set), never computed from a real pick.
 */
function ScoringExample({ name }: { name: string }) {
  const event = useEvent();
  const { t } = useT();
  const { winner_points: wp, sets_points: sp, per_set_exact: pe } = event.rules;
  const lines: [string, number][] = [
    [t("example_winner"), wp.QF],
    [t("example_sets", { n: 2 }), sp.QF],
    [t("example_exact", { n: 1 }), pe],
  ];
  return (
    <section className="card mt-4 px-4 py-4" aria-labelledby="example-title">
      <h2 id="example-title" className="headline text-lg">
        {t("example_title")}
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <p className="rounded-xl bg-raised px-3 py-2">
          <span className="block text-2xs font-bold uppercase tracking-wider text-ink-3">
            {t("example_you_pick")}
          </span>
          <span className="num">{name} 6-4 6-3</span>
        </p>
        <p className="rounded-xl bg-raised px-3 py-2">
          <span className="block text-2xs font-bold uppercase tracking-wider text-ink-3">
            {t("example_result")}
          </span>
          <span className="num">{name} 6-4 7-5</span>
        </p>
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {lines.map(([label, pts]) => (
          <li key={label} className="flex justify-between gap-3 text-ink-2">
            <span>
              <span className="text-good">✓</span> {label}
            </span>
            <b className="num text-ink">+{pts}</b>
          </li>
        ))}
        <li className="flex justify-between gap-3 text-ink-3">
          <span>✗ {t("example_miss")}</span>
          <b className="num">+0</b>
        </li>
        <li className="mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold">
          <span>{t("example_total")}</span>
          <b className="num text-accent-text">{wp.QF + sp.QF + pe}</b>
        </li>
      </ul>
    </section>
  );
}
