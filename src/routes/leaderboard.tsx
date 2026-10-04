// The leaderboard is part of Standings since 4 Oct 2026 (Tino: one page for the global table and the
// friends leagues). Old links and bookmarks land there, with the same league, view and page.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/leaderboard")({
  beforeLoad: ({ location }) => {
    const s = location.search as Record<string, unknown>;
    throw redirect({
      to: "/standings",
      search: {
        ...(typeof s["league"] === "string" ? { league: s["league"] } : {}),
        ...(s["view"] === "me" ? { view: "me" as const } : {}),
        ...(Number(s["page"]) > 0 ? { page: Math.floor(Number(s["page"])) } : {}),
      },
      replace: true,
    });
  },
});
