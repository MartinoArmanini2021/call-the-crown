import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesQuery, myPicksQuery, playersQuery, type Pick } from "@/lib/api";
import { playerById } from "@/lib/format";
import { useAuth } from "./useAuth";

/** Players, the bracket and (signed in) the fan's own picks: what most screens need. */
export function useGame() {
  const { user } = useAuth();
  const players = useQuery(playersQuery);
  const matches = useQuery(matchesQuery);
  const picks = useQuery({ ...myPicksQuery(user?.id ?? ""), enabled: !!user });

  const byPlayer = useMemo(() => playerById(players.data ?? []), [players.data]);
  const pickByMatch = useMemo(
    () => new Map<number, Pick>((picks.data ?? []).map((p) => [p.match_no, p])),
    [picks.data],
  );
  const queries = user ? [players, matches, picks] : [players, matches];
  return { user, players, matches, picks, byPlayer, pickByMatch, queries };
}
