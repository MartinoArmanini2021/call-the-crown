// Pattern from grand-slam-gm/src/routes/__root.tsx: query client, auth, one screen_view per route.
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { EventProvider } from "@/config/eventConfig";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";

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
