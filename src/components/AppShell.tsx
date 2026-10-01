import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";
import { publicImage } from "@/lib/api";
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
  const { t } = useT();
  const { user } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const logo = publicImage(event.branding.logo_path);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/" className="focus-ring flex min-w-0 items-center gap-2 rounded">
            {logo ? (
              <img src={logo} alt={event.branding.app_name ?? event.name} className="h-7 w-auto" />
            ) : (
              <span className="headline truncate text-xl">
                <span className="text-accent">
                  {(event.branding.app_name ?? event.name).split(" ").slice(0, 2).join(" ")}
                </span>{" "}
                {(event.branding.app_name ?? event.name).split(" ").slice(2).join(" ")}
              </span>
            )}
          </Link>
          <nav className="flex shrink-0 items-center gap-1 text-sm">
            <Link
              to="/how-to-play"
              className="focus-ring rounded-full px-3 py-1.5 text-ink-2 hover:text-ink"
            >
              {t("how_to_play")}
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
                {(user.email ?? "?")[0]?.toUpperCase()}
              </Link>
            ) : (
              <Link
                to="/sign-in"
                className="focus-ring rounded-full bg-accent px-4 py-1.5 font-bold"
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
                  "focus-ring flex flex-col items-center gap-0.5 pt-2.5 text-[11px] font-semibold",
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

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="headline text-4xl">{title}</h1>
      {sub && <p className="mt-1.5 text-sm text-ink-2">{sub}</p>}
    </div>
  );
}
