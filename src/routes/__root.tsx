// Pattern from grand-slam-gm/src/routes/__root.tsx: query client, auth, one screen_view per route.
import { QueryClientProvider, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { EventProvider } from "@/config/eventConfig";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import { joinLeague } from "@/lib/api";
import { setActiveLeague, takePendingJoin } from "@/lib/leagueIntent";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorScreen,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <EventProvider>
        <AuthProvider>
          <ScreenTracker />
          <PendingJoin />
          <Outlet />
        </AuthProvider>
      </EventProvider>
    </QueryClientProvider>
  );
}

function ScreenTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    track("screen_view", { name: pathname === "/" ? "landing" : pathname.slice(1) });
  }, [pathname, loading]);
  return null;
}

/**
 * An invite opened while signed out (brief "bragging rights", Phase 2): the code waits in
 * sessionStorage through sign-up; once signed in it is used once, the fan joins the league and lands on
 * it with the "joined" message, without typing the code again. If the join is refused (a full league, a
 * removed member), the join sheet opens with the code filled in and the reason.
 */
function PendingJoin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Not during sign-up itself: the new fan still sets a password there.
  const onSignIn = useRouterState({ select: (s) => s.location.pathname === "/sign-in" });
  useEffect(() => {
    if (!user || onSignIn) return;
    const code = takePendingJoin();
    if (!code) return;
    const fallback = () => void navigate({ to: "/standings", search: { join: code } });
    joinLeague(code).then((r) => {
      if (!r.ok || !r.league_id) return fallback();
      setActiveLeague(user.id, r.league_id);
      void qc.invalidateQueries({ queryKey: ["leagues"] });
      void navigate({ to: "/standings", search: { league: r.league_id, joined: r.name ?? "" } });
    }, fallback);
  }, [user, onSignIn, navigate, qc]);
  return null;
}

function NotFound() {
  const { t } = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <p className="headline text-6xl text-accent">404</p>
        <p className="mt-3 text-ink-2">{t("not_found")}</p>
        <Link
          to="/"
          className="focus-ring mt-5 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-bold"
        >
          {t("go_home")}
        </Link>
      </div>
    </div>
  );
}

function ErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <p className="headline text-3xl">Something went wrong</p>
        <button
          type="button"
          onClick={reset}
          className="focus-ring mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-bold"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
