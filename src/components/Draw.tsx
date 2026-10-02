// "Road to the crown": the draw on Results (Tino, 2 Oct 2026: "more visual, more engaging, more
// dynamic"). Built upright for a phone: the top half of the draw flows down, the bottom half flows
// up, and both meet at the Final in the middle under a crown, with the third-place match beside it.
//   Quarter-final 1  →  Semi-final 1  →  THE FINAL  ←  Semi-final 2  ←  Quarter-final 2
// A stage strip on top says where the event is and what is next. Every card shows the players by
// name in their colours, the set scores once played, a live pulse while in play, and your pick with
// ✓ +points / ✗ once settled (stored by the server, never worked out here). The line between two
// matches lights up gold once the winner is through. The structure comes from the bracket's sources,
// so any six-player draw with two byes works; anything else falls back to a list by round.
import type { ReactNode } from "react";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { localDay, localTime, matchState, shortTimeLeft, surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playerName } from "./Brand";
import { useMatchLabel } from "./MatchCard";
import { useMatchNames } from "./matchNames";
import { SIDE_COLOR } from "./sides";

type Props = {
  matches: Match[];
  players: Map<string, Player>;
  pickByMatch: Map<number, Pick>;
  now: number;
  onSelect: (m: Match) => void;
};

const feeds = (from: Match, to: Match) =>
  [to.p1_source, to.p2_source].some((s) => s.type !== "player" && s.match === from.match_no);

export function Draw(props: Props) {
  const { matches } = props;
  const sfs = matches.filter((m) => m.round === "SF").sort((a, b) => a.match_no - b.match_no);
  const final = matches.find((m) => m.round === "F");
  const third = matches.find((m) => m.round === "3P");
  const qfFor = (sf: Match | undefined) =>
    sf && matches.find((m) => m.round === "QF" && feeds(m, sf));
  const [sf1, sf2] = sfs;
  const qf1 = qfFor(sf1);
  const qf2 = qfFor(sf2);

  if (!sf1 || !sf2 || !final || !qf1 || !qf2) {
    // Not the six-player shape: every match as a card, in round order.
    return (
      <div className="space-y-3">
        <StageStrip {...props} />
        {matches.map((m) => (
          <DrawCard key={m.match_no} m={m} {...props} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <StageStrip {...props} />
      <div className="mt-4 flex flex-col">
        <DrawCard m={qf1} {...props} />
        <Connector from={qf1} to={sf1} down {...props} />
        <DrawCard m={sf1} {...props} />
        <Connector from={sf1} to={final} down {...props} />
        <FinalBlock final={final} third={third} {...props} />
        <Connector from={sf2} to={final} down={false} {...props} />
        <DrawCard m={sf2} {...props} />
        <Connector from={qf2} to={sf2} down={false} {...props} />
        <DrawCard m={qf2} {...props} />
      </div>
    </div>
  );
}

/** Quarter-finals · Semi-finals · Final day: done ✓, now (glowing), to come; and the next match. */
function StageStrip({ matches, players, now }: Props) {
  const { t, locale } = useT();
  const event = useEvent();
  const { title } = useMatchNames(players);
  const stages = [
    { key: "bracket_qf" as const, rounds: ["QF"] },
    { key: "bracket_sf" as const, rounds: ["SF"] },
    { key: "bracket_last" as const, rounds: ["3P", "F"] },
  ].map((st) => {
    const ms = matches.filter((m) => st.rounds.includes(m.round));
    const first = ms
      .map((m) => m.starts_at)
      .filter(Boolean)
      .sort()[0];
    const done = ms.length > 0 && ms.every((m) => m.status !== "scheduled");
    return { ...st, ms, first, done };
  });
  const current = stages.findIndex((s) => !s.done);
  const next = matches
    .filter((m) => m.status === "scheduled" && m.starts_at && Date.parse(m.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))[0];
  const live = matches.find((m) => matchState(m, now) === "locked");

  return (
    <div className="card overflow-hidden p-3">
      <ol className="grid grid-cols-3 gap-1.5">
        {stages.map((s, i) => (
          <li
            key={s.key}
            className={cn(
              "rounded-xl px-2 py-2 text-center",
              i === current ? "bg-accent/15 ring-1 ring-inset ring-accent/60" : "bg-raised",
            )}
          >
            <span
              className={cn(
                "headline block whitespace-nowrap text-[15px] leading-tight",
                s.done ? "text-ink-3" : "text-ink",
              )}
            >
              {s.done && <span className="text-good">✓ </span>}
              {t(s.key)}
            </span>
            <span className="block text-[11px] text-ink-3">
              {s.first ? localDay(s.first, event.timezone, locale) : ""}
            </span>
          </li>
        ))}
      </ol>
      {(live || next) && (
        <p className="mt-2.5 flex items-center justify-between gap-2 px-1 text-xs">
          {live ? (
            <span className="flex items-center gap-1.5 font-semibold text-accent-text">
              <span className="skg-live-dot h-2 w-2 rounded-full bg-accent" />
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
    </div>
  );
}

/** The line between two matches: gold once the winner is through, a moving dash before. */
function Connector({
  from,
  to,
  down,
  matches,
  players,
}: Props & { from: Match; to: Match; down: boolean }) {
  const { t, locale } = useT();
  const label = useMatchLabel();
  const through = from.status !== "scheduled" && from.winner_id;
  const name = through ? surname(playerName(players.get(from.winner_id!), locale)) : null;
  return (
    <div className="relative flex h-12 items-center justify-center" aria-hidden>
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2",
          through
            ? "bg-gradient-to-b from-gold/40 via-gold to-gold/40"
            : cn("skg-flow opacity-60", !down && "skg-flow-up"),
        )}
      />
      <span
        className={cn(
          "relative rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
          through ? "border-gold/50 bg-bg text-gold" : "border-line bg-bg text-ink-3",
        )}
      >
        {through
          ? `${t("draw_through", { name: name! })} ${down ? "↓" : "↑"}`
          : `${t("draw_winner_to", { match: label(to, matches) })} ${down ? "↓" : "↑"}`}
      </span>
    </div>
  );
}

/** The Final under a crown, with the third-place match beside it. */
function FinalBlock(props: Props & { final: Match; third: Match | undefined }) {
  const { final, third, players } = props;
  const { t, locale } = useT();
  const champion =
    final.status !== "scheduled" && final.winner_id
      ? playerName(players.get(final.winner_id), locale)
      : null;
  return (
    <section className="relative rounded-3xl border border-gold/40 bg-[radial-gradient(120%_70%_at_50%_0%,rgb(242_193_78/0.16),transparent_70%)] p-3">
      <div className="mb-2 flex flex-col items-center text-gold">
        <Crown className={cn("h-8 w-8", champion && "skg-crown")} />
        {champion ? (
          <p className="mt-1 text-center">
            <span className="block text-[11px] font-bold uppercase tracking-[0.2em]">
              {t("draw_champion")}
            </span>
            <span className="headline block text-3xl leading-tight text-ink">{champion}</span>
          </p>
        ) : (
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em]">{t("draw_who")}</p>
        )}
      </div>
      <DrawCard m={final} big {...props} />
      {third && (
        <div className="mt-2">
          <DrawCard m={third} small {...props} />
        </div>
      )}
    </section>
  );
}

function DrawCard({
  m,
  big = false,
  small = false,
  matches,
  players,
  pickByMatch,
  now,
  onSelect,
}: Props & { m: Match; big?: boolean; small?: boolean }) {
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

  const row = (side: 1 | 2) => {
    const id = side === 1 ? m.p1_id : m.p2_id;
    const won = settled && m.winner_id === id && id !== null;
    const lost = settled && !won;
    const games = settled
      ? (m.set_scores ?? []).map((s) => (side === 1 ? s.p1_games : s.p2_games))
      : [];
    const mine = pick?.winner_id === id && id !== null;
    return (
      <div className={cn("flex items-center gap-2.5", lost && "opacity-45")}>
        <span className={cn("h-5 shrink-0 border-s-2", SIDE_COLOR[side].line)} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            id ? "font-semibold text-ink" : "text-ink-3",
            big && id && "text-lg",
          )}
        >
          {id ? nameOf(id) : slot(m, side, matches)}
          {mine && (
            <span className={cn("ms-1.5 text-[10px] font-bold uppercase", SIDE_COLOR[side].text)}>
              {t("draw_mine")}
            </span>
          )}
        </span>
        {won && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" />}
        <span className="num flex shrink-0 gap-2 text-base">
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

  // The last line adds what the row tag ("your pick") does not say: the outcome, or the lock.
  const scored = (pick?.pts_total ?? 0) > 0;
  const footer: ReactNode = settled ? (
    pick ? (
      <span className={cn("font-semibold", scored ? "text-good" : "text-ink-3")}>
        {scored ? `✓ ${t("draw_called")}` : `✗ ${t("draw_missed")}`} ·{" "}
        {t("plus_pts", { points: pick.pts_total ?? 0 })}
      </span>
    ) : null
  ) : state === "open" ? (
    todo ? (
      <span className="font-bold text-accent-text">
        {t("draw_pick_now", { time: shortTimeLeft(left, locale) })} →
      </span>
    ) : (
      <span className="text-ink-2">
        ✓ {t("draw_picked")} · {t("locks_in", { time: shortTimeLeft(left, locale) })}
      </span>
    )
  ) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(m)}
      disabled={state === "waiting"}
      aria-label={`${label(m, matches)}: ${slot(m, 1, matches)} – ${slot(m, 2, matches)}`}
      className={cn(
        "focus-ring block w-full rounded-2xl border bg-card text-start transition-colors",
        small ? "p-2.5 text-sm" : "p-3.5",
        todo ? "skg-glow border-accent" : live ? "border-accent/60" : "border-line",
        state !== "waiting" && "hover:border-ink-3",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-bold uppercase tracking-wider text-ink-3">{label(m, matches)}</span>
        {status}
      </div>
      <div className={cn("space-y-1.5", big && "space-y-2")}>
        {row(1)}
        {row(2)}
      </div>
      {footer && <div className="mt-2.5 border-t border-line pt-2 text-xs">{footer}</div>}
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
