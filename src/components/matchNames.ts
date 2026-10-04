// Players by name, everywhere (Tino, 2 Oct 2026: "Use the player names"). A slot whose player is not
// known yet says where the player comes from, short (Tino, 4 Oct 2026: "Winner A in the Semis and the
// same in the Final; no carry-over names that make the text too long"): the semi-final against the
// winner of Fritz v Zverev reads "Alcaraz v Winner QF1"; the final before the semis, "Winner SF1 v
// Winner SF2"; the 3rd-place match, "Loser SF1 v Loser SF2". Once that match is played, the name.
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
  /** "QF1", "SF2": a match by its short round code and number within the round. */
  const short = (m: Match, matches: Match[]) => {
    const same = matches.filter((x) => x.round === m.round);
    const n = same.length > 1 ? same.findIndex((x) => x.match_no === m.match_no) + 1 : "";
    return t("match_short", { round: t(`short_${m.round}`), n });
  };
  /** "Fritz", or where the player comes from: "Winner QF1", "Loser SF2". */
  const slot = (m: Match, side: 1 | 2, matches: Match[]) => {
    const known = slotCandidates(m, side, matches);
    if (known.length === 1) return nameOf(known[0]!);
    const src = side === 1 ? m.p1_source : m.p2_source;
    const from = src.type !== "player" ? matches.find((x) => x.match_no === src.match) : undefined;
    if (!from) return t("to_be_decided");
    return t(src.type === "winner" ? "slot_winner" : "slot_loser", { match: short(from, matches) });
  };
  /** "Fritz v Zverev", "Alcaraz v Winner QF1". */
  const title = (m: Match, matches: Match[]) =>
    t("vs_title", { a: slot(m, 1, matches), b: slot(m, 2, matches) });
  return { slot, title };
}
