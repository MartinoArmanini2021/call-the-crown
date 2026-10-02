// The pick sheet: a panel that slides up over the page, so a whole pick fits one phone screen and
// Save is always visible (first-time-fan test and Tino's follow-up, 2 Oct 2026):
//   1. who wins the match (with the stored winner points);
//   2. each set: a toggle for who wins it (both start on the match winner; giving set 1 or 2 to the
//      other player brings set 3, the match winner's), then the score as chips from the set
//      winner's side ("6-4").
// Under the chips, a TV-style scoreboard fills in as you tap, in the match's fixed order (player 1's
// row on top, games under each set): that is the pick as stored and as Results shows it.
// The server (save_pick) remains the authority; the client check only enables the button.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { errorText, useT } from "@/i18n/useT";
import { savePick, type Match, type Pick, type Player } from "@/lib/api";
import { track } from "@/lib/analytics";
import { localTime, shortTimeLeft, surname } from "@/lib/format";
import {
  fromPick,
  setCount,
  setWinner,
  shaped,
  toSetScores,
  winnerLine,
  withScore,
  withSetWinner,
  withWinner,
  type Draft,
  type Side,
} from "@/lib/pickDraft";
import { cn } from "@/lib/utils";
import { validateSetScores, type SetScore } from "@/lib/validation";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";
import { useMatchNames } from "./matchNames";
import { SIDE_COLOR } from "./sides";
import { Scoreboard } from "./Scoreboard";

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
  const { title } = useMatchNames(players);
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
  const invalid = shaped(draft)
    ? validateSetScores(event.rules, draft.winner, n, setScores)
    : "incomplete";
  const savedKey = useMemo(() => {
    const d = fromPick(match, pick);
    return JSON.stringify([d.winner, toSetScores(d)]);
  }, [match, pick]);
  const dirty = JSON.stringify([draft.winner, setScores]) !== savedKey;
  // A ceiling, from the stored winner points and the configured set points: never the score itself.
  const ceiling =
    draft.winner && draft.format && points[draft.winner] !== null
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
        aria-label={title(match, matches)}
        className="safe-bottom relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl border-t border-line bg-card"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
              {label(match, matches)}
            </p>
            <h2 className="headline text-2xl leading-tight">{title(match, matches)}</h2>
            {lockMs !== null && (
              <p className="text-[11px] font-semibold text-accent-text">
                {t("locks_in", { time: shortTimeLeft(lockMs, locale) })}
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
          <Question title={t("pick_winner")}>
            {([1, 2] as const).map((s) => (
              <Choice
                key={s}
                side={s}
                on={draft.winner === s}
                onClick={() => change((d) => withWinner(d, s))}
                title={names[s]}
                sub={
                  points[s] !== null
                    ? `${t("pts_if_right", { points: points[s]! })}${points[s]! > base ? ` · ${t("upset_bonus")}` : ""}`
                    : undefined
                }
              />
            ))}
          </Question>

          {shaped(draft) && (
            <section className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                {t("pick_sets")}
              </p>
              {Array.from({ length: n }, (_, i) => {
                const by = setWinner(draft, i);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                        <span
                          aria-hidden
                          className={cn("h-2.5 w-2.5 rounded-full", SIDE_COLOR[by].dot)}
                        />
                        {t("set_n", { n: i + 1 })}
                        {i === 2 && <span className="text-ink-3"> · {t("set_decider")}</span>}
                      </span>
                      <div
                        role="group"
                        aria-label={t("set_who_aria", { n: i + 1 })}
                        className="flex rounded-full bg-raised p-0.5"
                      >
                        {([1, 2] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={by === s}
                            // set 3 always goes to the match winner
                            disabled={i === 2 && s !== draft.winner}
                            onClick={() => i < 2 && change((d) => withSetWinner(d, i as 0 | 1, s))}
                            className={cn(
                              "focus-ring max-w-[8rem] truncate rounded-full px-3 py-1 text-xs font-bold transition-colors disabled:opacity-30",
                              by === s ? SIDE_COLOR[s].fill : SIDE_COLOR[s].text,
                            )}
                          >
                            {short(s)}
                          </button>
                        ))}
                      </div>
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
                              score: t("wins_score", { name: short(by), score: `${hi}-${lo}` }),
                            })}
                            onClick={() => change((d) => withScore(d, i, [hi, lo]))}
                            className={cn(
                              "focus-ring num rounded-lg py-2 text-[13px] transition-colors",
                              on ? SIDE_COLOR[by].fill : "bg-raised text-ink-2 hover:text-ink",
                            )}
                          >
                            {hi}-{lo}
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
            <Scoreboard
              names={{ 1: short(1), 2: short(2) }}
              winner={draft.winner}
              sets={setScores}
              n={draft.format ? n : 2}
              caption={t("scoreboard_caption")}
            />
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
            {save.isPending
              ? t("saving")
              : pick && !dirty
                ? `✓ ${t("saved")}`
                : ceiling !== null
                  ? t("save_up_to", { points: ceiling })
                  : t("save_pick")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

function Choice({
  side,
  on,
  onClick,
  title,
  sub,
}: {
  side: 1 | 2;
  on: boolean;
  onClick: () => void;
  title: string;
  sub?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "focus-ring flex flex-col items-start rounded-2xl border-s-4 px-3 py-2.5 text-start transition-colors",
        SIDE_COLOR[side].edge,
        on ? SIDE_COLOR[side].fill : "bg-raised text-ink-2 hover:text-ink",
      )}
    >
      <span className={cn("w-full truncate text-sm font-bold", !on && SIDE_COLOR[side].text)}>
        {title}
      </span>
      {sub && <span className={cn("text-[11px]", on ? "text-bg/80" : "text-ink-3")}>{sub}</span>}
    </button>
  );
}
