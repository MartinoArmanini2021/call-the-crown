import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PrizeStrip, SponsorSlot } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  const event = useEvent();
  const { t } = useT();
  const { user } = useAuth();
  const name = event.branding.app_name ?? event.name;

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-accent-deep/60 via-card to-bg px-6 pb-8 pt-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-accent/30 blur-3xl"
        />
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-text">
          {t("landing_kicker")}
        </p>
        <h1 className="headline mt-3 text-6xl sm:text-7xl">{t("landing_title")}</h1>
        <p className="headline mt-2 text-2xl text-ink-2">{name}</p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-2">{t("landing_body")}</p>
        <Link
          to={user ? "/picks" : "/sign-in"}
          className="focus-ring mt-7 inline-flex h-12 items-center rounded-full bg-accent px-7 text-sm font-bold shadow-[0_8px_30px_-8px_var(--accent)]"
        >
          {user ? t("landing_cta_signed_in") : t("landing_cta")}
        </Link>
      </section>

      <ol className="mt-5 grid grid-cols-3 gap-2">
        {(["landing_step1", "landing_step2", "landing_step3"] as const).map((k, i) => (
          <li key={k} className="card px-3 py-4">
            <span className="num text-2xl text-accent">{i + 1}</span>
            <p className="headline mt-1 text-base leading-tight">{t(k)}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5">
        <PrizeStrip />
      </div>

      <SponsorSlot slot="landing_strip" className="mt-5" />

      <p className="mt-6 text-center text-xs text-ink-3">
        <Link to="/how-to-play" className="focus-ring underline underline-offset-2">
          {t("how_to_play")}
        </Link>
      </p>
    </AppShell>
  );
}
