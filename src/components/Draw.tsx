// The draw on Results, horizontal (Tino, 3 Oct 2026: "a horizontal structure that adapts to the
// screen ... almost interactive"; the big gold box and the player colours go). Three stage columns,
// left to right: Quarter-finals → Semi-finals → Final day. On a phone held upright they are a
// carousel: one column fills the screen with the next peeking in, a swipe moves a stage, and the
// stage tabs on top both show where you are and jump there. Held sideways (or on a wider screen) all
// three columns sit side by side. It opens on the current stage. Each card: the players by name with
// their ranking, set scores once played, the winner with a small crown, a live pulse, where the
// winner goes next, and your pick with ✓ +points / ✗. The final has its own card (4 Oct 2026: "the
// final should look special"); the 3rd-place match sits under it, quieter.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localDay, localTime, matchState, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";
import { useMatchNames } from "./matchNames";

type Props = {
  matches: Match[];
  players: Map<string, Player>;
  pickByMatch: Map<number, Pick>;
  now: number;
  onSelect: (m: Match) => void;
};

const STAGES = [
  { key: "bracket_qf", rounds: ["QF"] },
  { key: "bracket_sf", rounds: ["SF"] },
  { key: "bracket_last", rounds: ["F", "3P"] },
] as const;

export function Draw(props: Props) {
  const { matches, players, now } = props;
  const { t, locale } = useT();
  const event = useEvent();
  const { title } = useMatchNames(players);
  const scroller = useRef<HTMLDivElement>(null);

  const stages = STAGES.map((st) => {
    const ms = matches
      .filter((m) => (st.rounds as readonly string[]).includes(m.round))
      .sort(
        (a, b) =>
          st.rounds.indexOf(a.round as never) - st.rounds.indexOf(b.round as never) ||
          a.match_no - b.match_no,
      );
    const first = ms
      .map((m) => m.starts_at)
      .filter(Boolean)
      .sort()[0];
    const done = ms.length > 0 && ms.every((m) => m.status !== "scheduled");
    return { ...st, ms, first, done };
  });
  // The stage still to be played; once everything is played, the final day (the champion).
  const firstOpen = stages.findIndex((s) => !s.done);
  const current = firstOpen === -1 ? stages.length - 1 : firstOpen;
  const [active, setActive] = useState(current);

  // Which column is in view (phone carousel); every column is in view when they sit side by side.
  const columns = () => [...(scroller.current?.children ?? [])] as HTMLElement[];
  // Sideways only (the page itself never jumps), by the distance to the column's start edge, so it
  // works in both directions (Arabic scrolls right to left).
  const goTo = (i: number, smooth = true) => {
    const box = scroller.current;
    const col = columns()[i];
    if (!box || !col) return;
    const style = getComputedStyle(box);
    const pad = parseFloat(style.paddingInlineStart) || 0;
    const b = box.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const delta = style.direction === "rtl" ? c.right - (b.right - pad) : c.left - (b.left + pad);
    // already in place (a tap on the selected tab): scrolling by a sub-pixel delta would snap back
    if (Math.abs(delta) >= 1) box.scrollBy({ left: delta, behavior: smooth ? "smooth" : "auto" });
    setActive(i);
  };
  useEffect(() => {
    goTo(current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  // the column most in view is the active one (direction-proof)
  const onScroll = () => {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return;
    let best = 0;
    let most = -1;
    columns().forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const seen = Math.min(r.right, box.right) - Math.max(r.left, box.left);
      if (seen > most) [best, most] = [i, seen];
    });
    setActive(best);
  };

  const next = matches
    .filter((m) => m.status === "scheduled" && m.starts_at && Date.parse(m.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))[0];
  const live = matches.find((m) => matchState(m, now) === "locked");

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label={t("draw_title")}>
        {stages.map((s, i) => {
          const last = s.key === "bracket_last";
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active === i}
              onClick={() => goTo(i)}
              className={cn(
                "focus-ring rounded-xl px-2 py-2 text-center transition-colors",
                active === i
                  ? last
                    ? "bg-raised ring-1 ring-inset ring-gold/60"
                    : "bg-raised ring-1 ring-inset ring-ink-3"
                  : "bg-card",
              )}
            >
              <span
                className={cn(
                  "headline flex items-center justify-center gap-1 whitespace-nowrap text-[15px] leading-tight",
                  s.done
                    ? "text-ink-3"
                    : last
                      ? "text-gold"
                      : i === current
                        ? "text-ink"
                        : "text-ink-2",
                )}
              >
                {s.done && <span className="text-good">✓</span>}
                {last && !s.done && <Crown className="h-3.5 w-3.5 shrink-0" />}
                {t(s.key)}
              </span>
              <span className="block text-2xs text-ink-3">
                {s.first ? localDay(s.first, event.timezone, locale) : ""}
              </span>
            </button>
          );
        })}
      </div>

      {(live || next) && (
        <p className="mt-2 flex items-center justify-between gap-2 px-1 text-xs">
          {live ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold text-accent-text">
              <span className="skg-live-dot h-2 w-2 shrink-0 rounded-full bg-accent" />
              {t("draw_live")} · {title(live, matches)}
            </span>
          ) : (
            <span className="min-w-0 truncate text-ink-2">
              {t("draw_next")} <b className="text-ink">{title(next!, matches)}</b>
            </span>
          )}
          {!live && next?.starts_at && (
            <span className="num shrink-0 text-accent-text">
              {shortTimeLeft(Date.parse(next.starts_at) - now, locale)}
            </span>
          )}
        </p>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {stages.map((s, i) => (
          <section
            key={s.key}
            aria-label={t(s.key)}
            className="flex w-[84%] shrink-0 snap-start flex-col justify-around gap-3 sm:w-auto"
          >
            {s.ms.map((m) =>
              m.round === "F" ? (
                <FinalCard key={m.match_no} m={m} {...props} />
              ) : (
                <DrawCard key={m.match_no} m={m} compact={m.round === "3P"} {...props} />
              ),
            )}
            {i < stages.length - 1 && <span className="sr-only">→</span>}
          </section>
        ))}
      </div>

      {/* where you are in the carousel (phones held upright only) */}
      <div className="mt-3 flex justify-center gap-1.5 sm:hidden" aria-hidden>
        {stages.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              "h-1.5 rounded-full transition-all",
              active === i
                ? s.key === "bracket_last"
                  ? "w-5 bg-gold"
                  : "w-5 bg-ink"
                : "w-1.5 bg-ink-3/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}

type CardProps = Props & { m: Match };

/** The two player rows of a card: names with their ranking, the crown, set scores once played. */
function Rows({
  m,
  matches,
  players,
  pickByMatch,
  now,
  big = false,
  champion = false,
}: CardProps & { big?: boolean; champion?: boolean }) {
  const { t, locale } = useT();
  const { slot } = useMatchNames(players);
  const settled = matchState(m, now) === "settled";
  const pick = pickByMatch.get(m.match_no);
  const nameOf = (id: string) => surname(playerName(players.get(id), locale));
  return (
    <div className={big ? "space-y-2.5" : "space-y-1.5"}>
      {([1, 2] as const).map((side) => {
        const id = side === 1 ? m.p1_id : m.p2_id;
        const won = settled && m.winner_id === id && id !== null;
        const games = settled
          ? (m.set_scores ?? []).map((s) => (side === 1 ? s.p1_games : s.p2_games))
          : [];
        const rank = id ? players.get(id)?.rank_snapshot : undefined;
        return (
          <div
            key={side}
            className={cn("flex items-center gap-2", settled && !won && "opacity-45")}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                big && "text-lg",
                !id
                  ? "text-ink-3"
                  : won && champion
                    ? "font-semibold text-gold"
                    : "font-semibold text-ink",
              )}
            >
              {id ? nameOf(id) : slot(m, side, matches)}
              {rank != null && (
                <span className="num ms-1.5 text-2xs font-normal text-ink-3">#{rank}</span>
              )}
              {pick?.winner_id === id && id && (
                <span className="ms-1.5 text-2xs font-bold uppercase text-accent-text">
                  {t("draw_mine")}
                </span>
              )}
            </span>
            {won && <Crown className={cn("shrink-0 text-gold", big ? "h-4 w-4" : "h-3.5 w-3.5")} />}
            <span className={cn("num flex shrink-0 gap-2", big ? "text-lg" : "text-[15px]")}>
              {games.map((g, i) => {
                const set = m.set_scores![i]!;
                const setWon =
                  side === 1 ? set.p1_games > set.p2_games : set.p2_games > set.p1_games;
                return (
                  <span
                    key={i}
                    className={cn("w-3 text-center", setWon ? "text-ink" : "text-ink-3")}
                  >
                    {g}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The fan's pick once played (✓ +points / ✗), or the nudge while the match is open and unpicked. */
function PickFooter({ m, pickByMatch, now, center = false }: CardProps & { center?: boolean }) {
  const { t, locale } = useT();
  const state = matchState(m, now);
  const pick = pickByMatch.get(m.match_no);
  const scored = (pick?.pts_total ?? 0) > 0;
  const line =
    state === "settled" && pick ? (
      <span className={cn("font-semibold", scored ? "text-good" : "text-ink-3")}>
        {scored ? "✓" : "✗"} {t("plus_pts", { points: pick.pts_total ?? 0 })}
      </span>
    ) : state === "open" && !pick ? (
      <span className="font-semibold text-accent-text">
        {t("draw_pick_now", {
          time: shortTimeLeft(m.starts_at ? Date.parse(m.starts_at) - now : 0, locale),
        })}
      </span>
    ) : null;
  return line ? <div className={cn("mt-2 text-xs", center && "text-center")}>{line}</div> : null;
}

function Status({ m, now }: { m: Match; now: number }) {
  const { t, locale } = useT();
  const event = useEvent();
  const state = matchState(m, now);
  if (state === "locked")
    return (
      <span className="flex items-center gap-1 font-bold text-accent-text">
        <span className="skg-live-dot h-1.5 w-1.5 rounded-full bg-accent" />
        {t("draw_live")}
      </span>
    );
  if (state === "settled")
    return (
      <span className="text-ink-3">
        {t(m.status === "retired" ? "retired" : m.status === "walkover" ? "walkover" : "result")}
      </span>
    );
  return m.starts_at ? (
    <span className="text-ink-3">{localTime(m.starts_at, event.timezone, locale)}</span>
  ) : null;
}

/** A quarter-final, a semi-final, or (compact) the 3rd-place match. */
function DrawCard(props: CardProps & { compact?: boolean }) {
  const { m, matches, players, pickByMatch, now, onSelect, compact = false } = props;
  const { t, locale } = useT();
  const label = useMatchLabel();
  const { slot } = useMatchNames(players);
  const state = matchState(m, now);
  const settled = state === "settled";
  const todo = state === "open" && !pickByMatch.get(m.match_no);

  // Where the winner goes, by name: "Winner meets Alcaraz", "Winner to the final", "Fritz through".
  const next = matches.find((x) =>
    [x.p1_source, x.p2_source].some((s) => s.type === "winner" && s.match === m.match_no),
  );
  const fromP1 = next?.p1_source.type === "winner" && next.p1_source.match === m.match_no;
  const path = !next
    ? null
    : settled && m.winner_id
      ? t("draw_through", { name: surname(playerName(players.get(m.winner_id), locale)) })
      : next.round === "F"
        ? t("draw_winner_final")
        : t("draw_winner_meets", { name: slot(next, fromP1 ? 2 : 1, matches) });

  return (
    <button
      type="button"
      onClick={() => onSelect(m)}
      disabled={state === "waiting"}
      aria-label={`${label(m, matches)}: ${slot(m, 1, matches)} – ${slot(m, 2, matches)}`}
      className={cn(
        "focus-ring block w-full rounded-2xl border bg-card text-start transition-colors",
        compact ? "p-2.5 text-sm" : "p-3",
        todo
          ? "skg-glow border-accent"
          : state === "locked"
            ? "border-accent/60"
            : compact
              ? "border-line/60"
              : "border-line",
        state !== "waiting" && "hover:border-ink-3",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2 text-2xs">
        <span className="font-bold uppercase tracking-wider text-ink-3">{label(m, matches)}</span>
        <Status m={m} now={now} />
      </div>
      <Rows {...props} />
      {path && (
        <p className="mt-2 flex items-center gap-1 text-2xs text-ink-3">
          <span aria-hidden className="rtl:rotate-180">
            →
          </span>
          <span className={cn("truncate", settled && "font-semibold text-ink-2")}>{path}</span>
        </p>
      )}
      <PickFooter {...props} />
    </button>
  );
}

/**
 * The final looks like the occasion it is (Tino, 4 Oct 2026: "the final should look special"), without
 * the big text-heavy box of 2 Oct: a thin gold frame, a soft gold light from the top, the crown over a
 * big "Final", larger names. Once played, the champion's name in gold under the score.
 */
function FinalCard(props: CardProps) {
  const { m, matches, players, now, onSelect } = props;
  const { t, locale } = useT();
  const event = useEvent();
  const label = useMatchLabel();
  const { slot } = useMatchNames(players);
  const state = matchState(m, now);
  const champion =
    state === "settled" && m.winner_id
      ? surname(playerName(players.get(m.winner_id), locale))
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(m)}
      disabled={state === "waiting"}
      aria-label={`${label(m, matches)}: ${slot(m, 1, matches)} – ${slot(m, 2, matches)}`}
      className="skg-final focus-ring relative block w-full rounded-3xl p-px text-start"
    >
      <div className="skg-final-inner relative overflow-hidden rounded-[calc(1.5rem-1px)] px-4 pb-4 pt-4">
        <div className="flex flex-col items-center text-center">
          <Crown className="skg-crown h-7 w-7 text-gold" />
          <span className="headline mt-1 text-3xl leading-none text-gold">{label(m, matches)}</span>
          <span className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-3">
            <Status m={m} now={now} />
          </span>
        </div>
        <div className="mt-4">
          {state === "settled" ? <Rows {...props} big champion /> : <FaceOff {...props} />}
        </div>
        {champion && (
          <div className="mt-4 border-t border-gold/25 pt-3 text-center">
            <p className="text-2xs font-bold uppercase tracking-[0.2em] text-gold/80">
              {t("draw_champion")}
            </p>
            <p className="headline mt-0.5 text-3xl leading-none text-gold">{champion}</p>
          </div>
        )}
        <PickFooter {...props} center />
      </div>
    </button>
  );
}

/** Before the final is played: the two names face each other, centred, with their rankings. */
function FaceOff({ m, matches, players, pickByMatch }: CardProps) {
  const { t, locale } = useT();
  const { slot } = useMatchNames(players);
  const pick = pickByMatch.get(m.match_no);
  const side = (n: 1 | 2) => {
    const id = n === 1 ? m.p1_id : m.p2_id;
    const rank = id ? players.get(id)?.rank_snapshot : undefined;
    return (
      <div className="min-w-0 flex-1 text-center">
        <p
          className={cn("headline truncate text-2xl leading-tight", id ? "text-ink" : "text-ink-3")}
        >
          {id ? surname(playerName(players.get(id), locale)) : slot(m, n, matches)}
        </p>
        {rank != null && <p className="num text-xs text-ink-3">#{rank}</p>}
        {id && pick?.winner_id === id && (
          <p className="mt-0.5 text-2xs font-bold uppercase text-accent-text">{t("draw_mine")}</p>
        )}
      </div>
    );
  };
  return (
    <div className="flex items-start gap-2">
      {side(1)}
      <span className="headline pt-1 text-lg text-gold/70">{t("vs_short")}</span>
      {side(2)}
    </div>
  );
}

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.2 18H4.8L3 8.5Zm2 11h14v1.5H5V19.5Z" />
    </svg>
  );
}
