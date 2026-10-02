import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PrizeStrip, SponsorSlot, playerName } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useServerNow } from "@/hooks/useNow";
import { useT } from "@/i18n/useT";
import { matchesQuery, playersQuery, publicImage, type Player } from "@/lib/api";
import { shortTimeLeft, surname } from "@/lib/format";

export const Route = createFileRoute("/")({ component: Landing });

// The front door leads with the event: where and when, the six players, how long until the first
// picks close, and what each call is worth (all from config and the bracket; nothing hard-coded).
function Landing() {
  const event = useEvent();
  const { t, locale } = useT();
  const { user } = useAuth();
  const now = useServerNow();
  const players = useQuery(playersQuery);
  const matches = useQuery(matchesQuery);

  const firstLock = (matches.data ?? [])
    .filter((m) => m.status === "scheduled" && m.p1_id && m.p2_id && m.starts_at)
    .map((m) => Date.parse(m.starts_at!))
    .filter((ms) => ms > now)
    .sort((a, b) => a - b)[0];

  const { winner_points: wp, sets_points: sp, per_set_exact: pe } = event.rules;
  const range = (o: Record<string, number>) => {
    const v = Object.values(o);
    return `${Math.min(...v)}–${Math.max(...v)}`;
  };

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_80%_at_100%_0%,rgb(229_9_20/0.45),transparent_60%),linear-gradient(160deg,#1d0a0b,var(--bg)_70%)] px-5 pb-6 pt-7">
        {event.branding.event_line && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">
            {event.branding.event_line}
          </p>
        )}
        <h1 className="headline mt-3 text-6xl sm:text-7xl">{t("landing_title")}</h1>

        {(players.data ?? []).length > 0 && (
          <ul className="mt-5 grid grid-cols-6 gap-1.5" aria-label={t("landing_players")}>
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
            <span className="num text-3xl text-accent-text">{shortTimeLeft(firstLock - now)}</span>
          </p>
        )}

        <Link
          to={user ? "/picks" : "/sign-in"}
          className="focus-ring mt-5 inline-flex h-12 items-center rounded-full bg-accent px-7 text-sm font-bold shadow-[0_8px_30px_-8px_var(--accent)]"
        >
          {user ? t("landing_cta_signed_in") : t("landing_cta")}
        </Link>
      </section>

      <ul className="mt-4 grid grid-cols-3 gap-2" aria-label={t("htp_scoring")}>
        <WorthTile label={t("worth_winner")} value={range(wp)} note={t("worth_winner_note")} />
        <WorthTile label={t("worth_sets")} value={`+${range(sp)}`} note={t("worth_sets_note")} />
        <WorthTile label={t("worth_exact")} value={`+${pe}`} note={t("worth_exact_note")} />
      </ul>

      <div className="mt-4">
        <PrizeStrip />
      </div>

      <SponsorSlot slot="landing_strip" className="mt-4" />

      <p className="mt-6 text-center text-xs text-ink-3">
        <Link to="/how-to-play" className="focus-ring underline underline-offset-2">
          {t("how_to_play")}
        </Link>
      </p>
    </AppShell>
  );
}

/** A player as a portrait tile: the organiser's photo, or a short name until photos arrive. */
function Portrait({ player, name }: { player: Player; name: string }) {
  const img = publicImage(player.image_path);
  const last = surname(name).replace(/\s+/g, "");
  const short = last.slice(0, 3).toUpperCase();
  return (
    <div
      className="relative flex aspect-[3/4] items-end justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-raised to-card pb-1"
      title={name}
    >
      {img && <img src={img} alt={name} className="absolute inset-0 h-full w-full object-cover" />}
      <span
        className={
          img
            ? "headline relative text-sm text-ink drop-shadow"
            : "headline absolute inset-0 flex items-center justify-center text-xl text-ink-2"
        }
      >
        {short}
      </span>
    </div>
  );
}

function WorthTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="card grid gap-0.5 px-3 py-3">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="num text-2xl">{value}</span>
      <span className="text-[11px] text-ink-3">{note}</span>
    </li>
  );
}
