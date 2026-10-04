// Friends leagues are part of Standings since 4 Oct 2026 (Tino: one page for the global table and the
// leagues). An invite link sent before that, /leagues?code=XXXXXX, still works: it opens Standings with
// the join sheet and the code filled in.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/leagues")({
  beforeLoad: ({ location }) => {
    const code = (location.search as Record<string, unknown>)["code"];
    throw redirect({
      to: "/standings",
      search: typeof code === "string" ? { join: code } : {},
      replace: true,
    });
  },
});
