// The pick sheet: a panel that slides up over the page, so a whole pick fits one phone screen and
// Save is always visible. Flow (UX review, 2 Oct 2026):
//   1. who wins (with the stored winner points);
//   2. tap each set's score. Every set row starts on the chosen winner's side; "↔" gives that set to
//      the other player. The number of sets follows: two sets to the winner end it, a split brings
//      set 3, which the winner must take. No separate "how many sets" step, no "won by" switch.
// Scores always read in the match's fixed order: player 1's games first.
// The server (save_pick) remains the authority; the client check only enables the button.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEvent } from "@/config/eventConfig";
import { errorText, useT } from "@/i18n/useT";
import { savePick, type Match, type Pick, type Player } from "@/lib/api";
import { track } from "@/lib/analytics";
import { localTime, scoreLine, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { validateSetScores, type SetScore } from "@/lib/validation";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";

type Side = 1 | 2;
// scores[i] = [winner of the set's games, loser of the set's games]
type Draft = { winner: Side | null; sides: [Side, Side]; scores: ([number, number] | null)[] };

const other = (s: Side): Side => (s === 1 ? 2 : 1);
const setCount = (d: Draft) => (d.sides[0] === d.sides[1] ? 2 : 3);
const sideOf = (d: Draft, i: number): Side => (i === 2 ? d.winner! : d.sides[i as 0 | 1]);

function toSetScores(d: Draft): (SetScore | null)[] {
  if (!d.winner) return [];
  return Array.from({ length: setCount(d) }, (_, i) => {
    const sc = d.scores[i];
    if (!sc) return null;
    return sideOf(d, i) === 1
      ? { p1_games: sc[0], p2_games: sc[1] }
      : { p1_games: sc[1], p2_games: sc[0] };
  });
}

/** The score the way a fan says it, the match winner's games first: "6-4 3-6 6-3". */
function winnerLine(d: Draft): string {
  return d.scores
    .slice(0, setCount(d))
    .map((sc, i) =>
      sc ? (sideOf(d, i) === d.winner ? `${sc[0]}-${sc[1]}` : `${sc[1]}-${sc[0]}`) : "",
    )
    .join(" ");
}

function fromPick(m: Match, pick: Pick | undefined): Draft {
  if (!pick) return { winner: null, sides: [1, 1], scores: [null, null, null] };
  const winner: Side = pick.winner_id === m.p1_id ? 1 : 2;
  const won = (s: SetScore | undefined): Side => (s && s.p1_games < s.p2_games ? 2 : 1);
  const scores = [0, 1, 2].map((i) => {
    const s = pick.set_scores[i];
    return s
      ? ([Math.max(s.p1_games, s.p2_games), Math.min(s.p1_games, s.p2_games)] as [number, number])
      : null;
  });
  return { winner, sides: [won(pick.set_scores[0]), won(pick.set_scores[1])], scores };
}

export function PickSheet({
  match,
  matches,
  pick,
  players,
  uid,
  now,
  onClose,
  onSaved,
}: {
  match: Match;
  matches: Match[];
  pick: Pick | undefined;
  players: Map<string, Player>;
  uid: string;
  now: number;
  onClose: () => void;
  /** after a save that changed the pick: what was saved and until when it can change */
  onSaved?: (saved: { pick: string; until: string }) => void;
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const label = useMatchLabel();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromPick(match, pick));
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Behave like a dialog: lock the page behind, Escape closes, focus moves in and back out.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const names: Record<Side, string> = {
    1: playerName(players.get(match.p1_id!), locale),
    2: playerName(players.get(match.p2_id!), locale),
  };
  const short = (s: Side) => surname(names[s]);
  const points: Record<Side, number | null> = { 1: match.p1_win_points, 2: match.p2_win_points };
  const base = event.rules.winner_points[match.round];

  const setScores = toSetScores(draft);
  const n = setCount(draft);
  const invalid = validateSetScores(event.rules, draft.winner, n, setScores);
  const savedKey = useMemo(() => {
    const d = fromPick(match, pick);
    return JSON.stringify([d.winner, toSetScores(d)]);
  }, [match, pick]);
  const dirty = JSON.stringify([draft.winner, setScores]) !== savedKey;
  // A ceiling, from the stored winner points and the configured set points: never the score itself.
  const ceiling =
    draft.winner && points[draft.winner] !== null
      ? points[draft.winner]! + event.rules.sets_points[match.round] + event.rules.per_set_exact * n
      : null;

  const save = useMutation({
    mutationFn: () =>
      savePick(
        match.match_no,
        draft.winner === 1 ? match.p1_id! : match.p2_id!,
        n,
        setScores as SetScore[],
      ),
    onSuccess: async (r) => {
      if (r.changed) track("pick_saved", { match_no: match.match_no, round: match.round, sets: n });
      await qc.invalidateQueries({ queryKey: ["picks", uid] });
      onSaved?.({
        pick: t("wins_score", { name: short(draft.winner!), score: winnerLine(draft) }),
        until: localTime(match.starts_at!, event.timezone, locale),
      });
      onClose();
    },
    onError: (e) => setError(errorText(t, e)),
  });

  const change = (fn: (d: Draft) => Draft) => {
    setError(null);
    setDraft(fn);
  };
  const chooseWinner = (w: Side) =>
    change((d) => (d.winner === w ? d : { ...d, winner: w, sides: [w, w] }));
  const flip = (i: 0 | 1) =>
    change((d) => {
      const sides: [Side, Side] = [...d.sides];
      sides[i] = other(sides[i]);
      // the loser can take at most one of the first two sets
      if (sides[0] !== d.winner && sides[1] !== d.winner) sides[1 - i] = d.winner!;
      return { ...d, sides };
    });
  const chooseScore = (i: number, sc: [number, number]) =>
    change((d) => {
      const scores = [...d.scores];
      scores[i] = sc;
      return { ...d, scores };
    });

  const lockMs = match.starts_at ? Date.parse(match.starts_at) - now : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label(match, matches)}
        className="safe-bottom relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl border-t border-line bg-card"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <div>
            <h2 className="headline text-2xl">{label(match, matches)}</h2>
            {lockMs !== null && (
              <p className="text-[11px] font-semibold text-accent-text">
                {t("locks_in", { time: shortTimeLeft(lockMs) })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-raised text-lg text-ink-2"
            aria-label={t("close")}
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-3 pt-2">
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
              {t("pick_winner")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([1, 2] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={draft.winner === s}
                  onClick={() => chooseWinner(s)}
                  className={cn(
                    "focus-ring flex flex-col items-start rounded-2xl px-3 py-2.5 text-start transition-colors",
                    draft.winner === s
                      ? "bg-accent text-ink"
                      : "bg-raised text-ink-2 hover:text-ink",
                  )}
                >
                  <span className="w-full truncate text-sm font-bold">{names[s]}</span>
                  {points[s] !== null && (
                    <span
                      className={cn("text-[11px]", draft.winner === s ? "text-ink" : "text-ink-3")}
                    >
                      {t("plus_pts", { points: points[s]! })}
                      {points[s]! > base && ` · ${t("upset_bonus")}`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {draft.winner && (
            <section className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                {t("pick_sheet_scores", { p1: short(1) })}
              </p>
              {Array.from({ length: n }, (_, i) => {
                const side = sideOf(draft, i);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-ink-2">
                        {i === 2
                          ? t("set_decider", { name: short(side) })
                          : t("set_won_by_name", { n: i + 1, name: short(side) })}
                      </span>
                      {i < 2 && (
                        <button
                          type="button"
                          onClick={() => flip(i as 0 | 1)}
                          className="focus-ring rounded-full bg-raised px-2.5 py-1 font-semibold text-ink-2 hover:text-ink"
                        >
                          {t("give_set_to", { name: short(other(side)) })} ↔
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {event.rules.allowed_set_scores.map(([hi, lo]) => {
                        const on = draft.scores[i]?.[0] === hi && draft.scores[i]?.[1] === lo;
                        return (
                          <button
                            key={`${hi}-${lo}`}
                            type="button"
                            aria-pressed={on}
                            aria-label={t("set_score_aria", {
                              n: i + 1,
                              score: side === 1 ? `${hi}-${lo}` : `${lo}-${hi}`,
                            })}
                            onClick={() => chooseScore(i, [hi, lo])}
                            className={cn(
                              "focus-ring num rounded-lg py-2 text-[13px] transition-colors",
                              on ? "bg-accent text-ink" : "bg-raised text-ink-2 hover:text-ink",
                            )}
                          >
                            {side === 1 ? `${hi}-${lo}` : `${lo}-${hi}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        <div className="space-y-2 border-t border-line px-4 pb-3 pt-3">
          {draft.winner && (
            <div className="flex items-center justify-between rounded-xl bg-raised px-3 py-2 text-xs">
              <span className="num">
                <b>{short(draft.winner)}</b>{" "}
                {invalid === null ? scoreLine(setScores as SetScore[]) : "…"} · {t("n_sets", { n })}
              </span>
              {ceiling !== null && (
                <span className="text-ink-3">{t("up_to_pts", { points: ceiling })}</span>
              )}
            </div>
          )}
          {error && (
            <p className="text-xs text-accent-text" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={invalid !== null || !dirty || save.isPending}
            onClick={() => save.mutate()}
            className="focus-ring h-12 w-full rounded-full bg-accent text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? t("saving") : pick && !dirty ? `✓ ${t("saved")}` : t("save_pick")}
          </button>
        </div>
      </div>
    </div>
  );
}
