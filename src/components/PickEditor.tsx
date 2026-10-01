import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useEvent } from "@/config/eventConfig";
import { errorText, useT } from "@/i18n/useT";
import { savePick, type Match, type Pick, type Player } from "@/lib/api";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { validateSetScores, type SetScore } from "@/lib/validation";
import { playerName } from "./Brand";

type Slot = 1 | 2;

// The editor's own state: who wins, how many sets, which early set the loser took (3 sets only),
// and each set's score as [winner's games, loser's games].
type Draft = {
  winner: Slot | null;
  sets: 2 | 3 | null;
  loserSet: 0 | 1 | null;
  scores: ([number, number] | null)[];
};

function fromPick(m: Match, pick: Pick | undefined): Draft {
  if (!pick) return { winner: null, sets: null, loserSet: null, scores: [] };
  const winner: Slot = pick.winner_id === m.p1_id ? 1 : 2;
  const rowWinner = (s: SetScore): Slot => (s.p1_games > s.p2_games ? 1 : 2);
  const loserSet = pick.sets === 3 ? (rowWinner(pick.set_scores[0]!) !== winner ? 0 : 1) : null;
  return {
    winner,
    sets: pick.sets,
    loserSet,
    scores: pick.set_scores.map((s) => [
      Math.max(s.p1_games, s.p2_games),
      Math.min(s.p1_games, s.p2_games),
    ]),
  };
}

// Which player wins set i under this draft.
function setWinner(d: Draft, i: number): Slot | null {
  if (!d.winner || !d.sets) return null;
  if (d.sets === 2 || i === 2) return d.winner;
  if (d.loserSet === null) return null;
  return i === d.loserSet ? (d.winner === 1 ? 2 : 1) : d.winner;
}

function toSetScores(d: Draft): (SetScore | null)[] {
  if (!d.sets) return [];
  return Array.from({ length: d.sets }, (_, i) => {
    const sc = d.scores[i];
    const w = setWinner(d, i);
    if (!sc || !w) return null;
    return w === 1 ? { p1_games: sc[0], p2_games: sc[1] } : { p1_games: sc[1], p2_games: sc[0] };
  });
}

export function PickEditor({
  match,
  pick,
  players,
  uid,
}: {
  match: Match;
  pick: Pick | undefined;
  players: Map<string, Player>;
  uid: string;
}) {
  const event = useEvent();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromPick(match, pick));
  const [error, setError] = useState<string | null>(null);

  const p1 = players.get(match.p1_id!);
  const p2 = players.get(match.p2_id!);
  const names: Record<Slot, string> = { 1: playerName(p1, locale), 2: playerName(p2, locale) };
  const points: Record<Slot, number | null> = { 1: match.p1_win_points, 2: match.p2_win_points };
  const base = event.rules.winner_points[match.round];

  const setScores = toSetScores(draft);
  const invalid = validateSetScores(event.rules, draft.winner, draft.sets, setScores);
  const saved = useMemo(() => JSON.stringify(fromPick(match, pick)), [match, pick]);
  const dirty = JSON.stringify(draft) !== saved;

  const save = useMutation({
    mutationFn: () =>
      savePick(
        match.match_no,
        draft.winner === 1 ? match.p1_id! : match.p2_id!,
        draft.sets!,
        setScores as SetScore[],
      ),
    onSuccess: (r) => {
      setError(null);
      if (r.changed)
        track("pick_saved", { match_no: match.match_no, round: match.round, sets: draft.sets });
      void qc.invalidateQueries({ queryKey: ["picks", uid] });
    },
    onError: (e) => setError(errorText(t, e)),
  });

  const update = (patch: Partial<Draft>) => {
    setError(null);
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (patch.sets !== undefined) {
        next.scores = next.scores.slice(0, patch.sets ?? 0);
        if (patch.sets === 2) next.loserSet = null;
      }
      return next;
    });
  };

  const step = "text-[11px] font-bold uppercase tracking-wider text-ink-3";
  const chip = (active: boolean) =>
    cn(
      "focus-ring rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
      active
        ? "border-accent bg-accent text-ink"
        : "border-line bg-raised text-ink-2 hover:text-ink",
    );

  return (
    <div className="mt-3 space-y-4 border-t border-line pt-4">
      <div>
        <p className={step}>{t("pick_winner")}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([1, 2] as const).map((slot) => (
            <button
              key={slot}
              type="button"
              aria-pressed={draft.winner === slot}
              onClick={() => update({ winner: slot })}
              className={cn(
                chip(draft.winner === slot),
                "flex flex-col items-start py-2.5 text-start",
              )}
            >
              <span className="truncate">{names[slot]}</span>
              {points[slot] !== null && (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    draft.winner === slot ? "text-ink" : "text-ink-3",
                  )}
                >
                  {t("win_points", { points: points[slot]! })}
                  {points[slot]! > base && ` · ${t("upset_bonus")}`}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {draft.winner && (
        <div>
          <p className={step}>{t("pick_sets")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={draft.sets === n}
                onClick={() => update({ sets: n })}
                className={chip(draft.sets === n)}
              >
                {t(n === 2 ? "sets_2" : "sets_3")}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.winner && draft.sets && (
        <div>
          <p className={step}>{t("pick_scores")}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            {names[1]} – {names[2]}
          </p>
          <div className="mt-2 space-y-3">
            {Array.from({ length: draft.sets }, (_, i) => {
              const w = setWinner(draft, i);
              const loser: Slot = draft.winner === 1 ? 2 : 1;
              return (
                <div key={i} className="rounded-xl bg-bg/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold">{t("set_n", { n: i + 1 })}</span>
                    {draft.sets === 3 && i < 2 ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                        {t("set_won_by")}
                        {([draft.winner!, loser] as Slot[]).map((s) => {
                          const takes = s === loser ? (i as 0 | 1) : ((1 - i) as 0 | 1);
                          return (
                            <button
                              key={s}
                              type="button"
                              aria-pressed={w === s}
                              onClick={() => update({ loserSet: takes })}
                              className={cn(
                                "focus-ring rounded-md px-2 py-1 font-semibold",
                                w === s ? "bg-ink text-bg" : "bg-raised text-ink-2",
                              )}
                            >
                              {names[s].split(" ").slice(-1)[0]}
                            </button>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-3">
                        {t("set_won_by")} {names[w ?? draft.winner!].split(" ").slice(-1)[0]}
                      </span>
                    )}
                  </div>
                  {w && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {event.rules.allowed_set_scores.map(([hi, lo]) => {
                        const active = draft.scores[i]?.[0] === hi && draft.scores[i]?.[1] === lo;
                        return (
                          <button
                            key={`${hi}-${lo}`}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              const scores = [...draft.scores];
                              scores[i] = [hi, lo];
                              update({ scores });
                            }}
                            className={cn(chip(active), "num min-w-[3.25rem] px-2 py-1.5")}
                          >
                            {w === 1 ? `${hi}-${lo}` : `${lo}-${hi}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-3" role="status">
          {error ? (
            <span className="text-accent-text">{error}</span>
          ) : save.isPending ? (
            t("saving")
          ) : dirty ? (
            draft.winner ? (
              t("unsaved")
            ) : (
              ""
            )
          ) : pick ? (
            <span className="text-good">✓ {t("saved")}</span>
          ) : (
            ""
          )}
        </span>
        <button
          type="button"
          disabled={invalid !== null || !dirty || save.isPending}
          onClick={() => save.mutate()}
          className="focus-ring h-11 rounded-full bg-accent px-6 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("save_pick")}
        </button>
      </div>
    </div>
  );
}
