// Each round-robin group's own colour (Tino, 13 Nov 2026: "can you colour code the different groups?"):
// McEnroe orange, Lendl fuchsia for the ATP Finals. From event_config.branding.group_colors when the
// event sets them (a plain hex per group name), otherwise from this palette in draw order. Chosen to
// stand apart from the brand blue, the aqua highlight, the lime "correct" and each other, also for
// colour-blind fans (orange reads yellow-ish, fuchsia blue-ish).
import { useCallback } from "react";
import { useEvent } from "@/config/eventConfig";
import type { Match } from "@/lib/api";

const PALETTE = ["#fb923c", "#e879f9", "#38bdf8", "#facc15"];
const HEX = /^#[0-9a-f]{6}$/i;

/** The groups in draw order (by their first match number). */
export function groupsInOrder(matches: Match[]): string[] {
  return [...matches]
    .filter((m) => m.round === "RR" && m.grp)
    .sort((a, b) => a.match_no - b.match_no)
    .map((m) => m.grp!)
    .filter((g, i, all) => all.indexOf(g) === i);
}

/** grp → its colour (undefined for no group). */
export function useGroupColor(matches: Match[]) {
  const event = useEvent();
  const set = (event.branding as { group_colors?: Record<string, string> }).group_colors ?? {};
  const order = groupsInOrder(matches).join("|");
  return useCallback(
    (grp: string | null | undefined): string | undefined => {
      if (!grp) return undefined;
      const own = set[grp];
      if (own && HEX.test(own)) return own;
      const i = order.split("|").indexOf(grp);
      return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, JSON.stringify(set)],
  );
}
