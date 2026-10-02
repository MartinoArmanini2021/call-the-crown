// Players by name, everywhere (Tino, 2 Oct 2026: "Use the player names"). A slot whose player is not
// known yet shows who it can still be, from the bracket's sources: the semi-final against the winner
// of Fritz v Zverev reads "Alcaraz v Fritz or Zverev"; the final, before the semis, "Alcaraz, Fritz
// or Zverev v Djokovic, de Minaur or Sinner". Never "TBD" or "the winner of Quarter-final 1".
import { useT } from "@/i18n/useT";
import type { Match, Player } from "@/lib/api";
import { surname } from "@/lib/format";
import { playerName } from "./Brand";

/** The player ids a slot can still hold. */
export function slotCandidates(m: Match, side: 1 | 2, matches: Match[], depth = 0): string[] {
  const id = side === 1 ? m.p1_id : m.p2_id;
  if (id) return [id];
  const src = side === 1 ? m.p1_source : m.p2_source;
  if (src.type === "player") return [src.id];
  const from = matches.find((x) => x.match_no === src.match);
  if (!from || depth > 4) return [];
  if (from.status !== "scheduled" && from.winner_id) {
    const loser = from.winner_id === from.p1_id ? from.p2_id : from.p1_id;
    const next = src.type === "winner" ? from.winner_id : loser;
    return next ? [next] : [];
  }
  return [
    ...slotCandidates(from, 1, matches, depth + 1),
    ...slotCandidates(from, 2, matches, depth + 1),
  ];
}

export function useMatchNames(players: Map<string, Player>) {
  const { t, locale } = useT();
  const nameOf = (id: string) => surname(playerName(players.get(id), locale));
  const list = (ids: string[]) =>
    ids.length === 0
      ? t("to_be_decided")
      : ids.length === 1
        ? nameOf(ids[0]!)
        : t("either", {
            names: ids.slice(0, -1).map(nameOf).join(", "),
            last: nameOf(ids[ids.length - 1]!),
          });
  /** "Fritz", or who it can still be: "Fritz or Zverev". */
  const slot = (m: Match, side: 1 | 2, matches: Match[]) => list(slotCandidates(m, side, matches));
  /** "Fritz v Zverev", "Alcaraz v Fritz or Zverev". */
  const title = (m: Match, matches: Match[]) =>
    t("vs_title", { a: slot(m, 1, matches), b: slot(m, 2, matches) });
  return { slot, title };
}
