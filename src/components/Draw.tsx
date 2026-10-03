// The draw on Results, horizontal (Tino, 3 Oct 2026: "a horizontal structure that adapts to the
// screen ... almost interactive"; the big gold box and the player colours go). Three stage columns,
// left to right: Quarter-finals → Semi-finals → Final day. On a phone held upright they are a
// carousel: one column fills the screen with the next peeking in, a swipe moves a stage, and the
// stage tabs on top both show where you are and jump there. Held sideways (or on a wider screen) all
// three columns sit side by side. It opens on the current stage. Each card: the players by name, set
// scores once played, the winner with a small crown, a live pulse, and your pick with ✓ +points / ✗.
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
  const current = Math.max(
    0,
    stages.findIndex((s) => !s.done),
  );
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
    box.scrollBy({ left: delta, behavior: smooth ? "smooth" : "auto" });
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
        {stages.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => goTo(i)}
            className={cn(
              "focus-ring rounded-xl px-2 py-2 text-center transition-colors",
              active === i ? "bg-raised ring-1 ring-inset ring-ink-3" : "bg-card",
            )}
          >
            <span
              className={cn(
                "headline block whitespace-nowrap text-[15px] leading-tight",
                s.done ? "text-ink-3" : i === current ? "text-ink" : "text-ink-2",
              )}
            >
              {s.done && <span className="text-good">✓ </span>}
              {t(s.key)}
            </span>
            <span className="block text-[11px] text-ink-3">
              {s.first ? localDay(s.first, event.timezone, locale) : ""}
            </span>
          </button>
        ))}
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
            {s.ms.map((m) => (
              <DrawCard key={m.match_no} m={m} final={m.round === "F"} {...props} />
            ))}
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
              active === i ? "w-5 bg-ink" : "w-1.5 bg-ink-3/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function DrawCard({
  m,
  final,
  matches,
  players,
  pickByMatch,
  now,
  onSelect,
}: Props & { m: Match; final: boolean }) {
  const { t, locale } = useT();
  const event = useEvent();
  const label = useMatchLabel();
  const { slot } = useMatchNames(players);
  const state = matchState(m, now);
  const pick = pickByMatch.get(m.match_no);
  const settled = state === "settled";
  const live = state === "locked";
  const todo = state === "open" && !pick;
  const left = m.starts_at ? Date.parse(m.starts_at) - now : 0;
  const nameOf = (id: string) => surname(playerName(players.get(id), locale));
  const champion = final && settled && m.winner_id ? nameOf(m.winner_id) : null;

  const row = (side: 1 | 2) => {
    const id = side === 1 ? m.p1_id : m.p2_id;
    const won = settled && m.winner_id === id && id !== null;
    const games = settled
      ? (m.set_scores ?? []).map((s) => (side === 1 ? s.p1_games : s.p2_games))
      : [];
    return (
      <div className={cn("flex items-center gap-2", settled && !won && "opacity-45")}>
        <span
          className={cn("min-w-0 flex-1 truncate", id ? "font-semibold text-ink" : "text-ink-3")}
        >
          {id ? nameOf(id) : slot(m, side, matches)}
          {pick?.winner_id === id && id && (
            <span className="ms-1.5 text-[10px] font-bold uppercase text-accent-text">
              {t("draw_mine")}
            </span>
          )}
        </span>
        {won && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" />}
        <span className="num flex shrink-0 gap-2 text-[15px]">
          {games.map((g, i) => {
            const set = m.set_scores![i]!;
            const setWon = side === 1 ? set.p1_games > set.p2_games : set.p2_games > set.p1_games;
            return (
              <span key={i} className={cn("w-3 text-center", setWon ? "text-ink" : "text-ink-3")}>
                {g}
              </span>
            );
          })}
        </span>
      </div>
    );
  };

  const status: ReactNode = live ? (
    <span className="flex items-center gap-1 font-bold text-accent-text">
      <span className="skg-live-dot h-1.5 w-1.5 rounded-full bg-accent" />
      {t("draw_live")}
    </span>
  ) : settled ? (
    <span className="text-ink-3">
      {t(m.status === "retired" ? "retired" : m.status === "walkover" ? "walkover" : "result")}
    </span>
  ) : m.starts_at ? (
    <span className="text-ink-3">{localTime(m.starts_at, event.timezone, locale)}</span>
  ) : null;

  const scored = (pick?.pts_total ?? 0) > 0;
  const footer: ReactNode =
    settled && pick ? (
      <span className={cn("font-semibold", scored ? "text-good" : "text-ink-3")}>
        {scored ? "✓" : "✗"} {t("plus_pts", { points: pick.pts_total ?? 0 })}
      </span>
    ) : todo ? (
      <span className="font-semibold text-accent-text">
        {t("draw_pick_now", { time: shortTimeLeft(left, locale) })}
      </span>
    ) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(m)}
      disabled={state === "waiting"}
      aria-label={`${label(m, matches)}: ${slot(m, 1, matches)} – ${slot(m, 2, matches)}`}
      className={cn(
        "focus-ring block w-full rounded-2xl border bg-card p-3 text-start transition-colors",
        final
          ? "border-gold/50"
          : todo
            ? "skg-glow border-accent"
            : live
              ? "border-accent/60"
              : "border-line",
        state !== "waiting" && "hover:border-ink-3",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px]">
        <span
          className={cn(
            "flex items-center gap-1 font-bold uppercase tracking-wider",
            final ? "text-gold" : "text-ink-3",
          )}
        >
          {final && <Crown className="h-3 w-3" />}
          {label(m, matches)}
        </span>
        {status}
      </div>
      <div className="space-y-1.5">
        {row(1)}
        {row(2)}
      </div>
      {champion && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-gold">
          <Crown className="skg-crown h-3.5 w-3.5" />
          {t("draw_champion")}: {champion}
        </p>
      )}
      {footer && <div className="mt-2 text-xs">{footer}</div>}
    </button>
  );
}

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.2 18H4.8L3 8.5Zm2 11h14v1.5H5V19.5Z" />
    </svg>
  );
}
