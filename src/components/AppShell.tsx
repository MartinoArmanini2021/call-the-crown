import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";
import { inLocale, profileQuery, publicImage } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/picks", key: "nav_picks", icon: "◎" },
  { to: "/results", key: "nav_results", icon: "✓" },
  { to: "/leaderboard", key: "nav_board", icon: "≡" },
  { to: "/leagues", key: "nav_leagues", icon: "◇" },
] as const;

// The frame of every screen: brand header, content column, bottom tabs (thumb reach on phones).
// Fans see only the organiser's brand here.
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const event = useEvent();
  const { t, locale } = useT();
  const { user } = useAuth();
  const profile = useQuery({ ...profileQuery(user?.id ?? ""), enabled: !!user });
  const avatar = (profile.data?.display_name || user?.email || "?").trim()[0]?.toUpperCase();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const logo = publicImage(event.branding.logo_path);
  // The header's short mark (branding.short_name, e.g. "Call the Crown"), drawn by Wordmark:
  // all but the last word on top, the last word underneath. The full app name stays in the page title.
  const headerName = (
    inLocale(event.branding, "short_name", locale) ??
    inLocale(event.branding, "app_name", locale) ??
    event.name
  ).split(" ");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:h-20">
          <Link to="/" className="focus-ring flex min-w-0 items-center gap-2 rounded">
            {logo ? (
              <img
                src={logo}
                alt={event.branding.app_name ?? event.name}
                className="h-11 w-auto sm:h-14"
              />
            ) : (
              <Wordmark words={headerName} spread={locale !== "ar"} />
            )}
          </Link>
          <nav className="flex shrink-0 items-center gap-1 text-sm">
            {/* On a phone a "?" keeps the full app name in view; the words from sm up. */}
            <Link
              to="/how-to-play"
              aria-label={t("how_to_play")}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-raised font-bold text-ink-2 hover:text-ink sm:h-auto sm:w-auto sm:bg-transparent sm:px-3 sm:py-1.5 sm:font-normal"
            >
              <span aria-hidden className="sm:hidden">
                ?
              </span>
              <span className="hidden sm:inline">{t("how_to_play")}</span>
            </Link>
            {user ? (
              <Link
                to="/profile"
                aria-label={t("nav_profile")}
                className={cn(
                  "focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-raised text-sm font-bold",
                  path === "/profile" && "bg-accent",
                )}
              >
                {avatar}
              </Link>
            ) : (
              <Link
                to="/sign-in"
                className="focus-ring rounded-full bg-accent px-3 py-1.5 sm:px-4 font-bold"
              >
                {t("sign_in")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main
        className={cn("mx-auto w-full flex-1 px-4 pb-28 pt-5", wide ? "max-w-3xl" : "max-w-xl")}
      >
        {children}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((tab) => {
            const active = path.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "focus-ring flex flex-col items-center gap-0.5 pt-2.5 text-2xs font-semibold",
                  active ? "text-ink" : "text-ink-3",
                )}
              >
                <span aria-hidden className={cn("text-lg leading-none", active && "text-accent")}>
                  {tab.icon}
                </span>
                {t(tab.key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * The game's name as a logo (Tino, 4 Oct 2026: "a bigger game name logo at the top"; then "go with the
 * crowned ball"): the mark, a red tennis ball wearing a gold crown (also public/favicon.svg), then two
 * stacked lines, all but the last word in white on top ("SIX KINGS SLAM") and the last word in gold
 * underneath ("PREDICTOR"), its letters spread to the same width so the two lines read as one block.
 * Arabic letters join, so they are never spread apart: centred instead.
 */
function Wordmark({ words, spread }: { words: string[]; spread: boolean }) {
  const top = words.slice(0, -1).join(" ");
  const last = words.slice(-1)[0] ?? "";
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 100 100" aria-hidden className="h-10 w-10 shrink-0 sm:h-12 sm:w-12">
        <circle cx="50" cy="60" r="34" fill="var(--accent)" />
        <path
          d="M23 37 C41 51 41 69 23 83"
          fill="none"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <path
          d="M77 37 C59 51 59 69 77 83"
          fill="none"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <g transform="rotate(-12 50 18)" fill="var(--gold)">
          <path d="M31 30 L31 12 L39 22 L50 6 L61 22 L69 12 L69 30 Z" />
          <rect x="30" y="29.5" width="40" height="5.5" rx="1.5" />
        </g>
      </svg>
      <span className="headline inline-grid leading-[0.92]">
        <span className="whitespace-nowrap text-[26px] text-ink sm:text-[34px]">{top}</span>
        {spread ? (
          <span aria-hidden className="flex justify-between text-[17px] text-gold sm:text-[22px]">
            {[...last].map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </span>
        ) : (
          <span className="text-center text-[17px] text-gold sm:text-[22px]">{last}</span>
        )}
        {spread && <span className="sr-only">{last}</span>}
      </span>
    </span>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="headline text-4xl">{title}</h1>
      {sub && <p className="mt-1.5 text-sm text-ink-2">{sub}</p>}
    </div>
  );
}
