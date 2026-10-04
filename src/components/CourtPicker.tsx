// Who wins, as a tennis court (Tino, 4 Oct 2026: "a slick nice court view and one player in each part
// of it. When you choose one player that part of the court lights up with the colours that we have
// already built in the app"). Seen from above, net across the middle: player 1 on the left half,
// player 2 on the right (mirrored in Arabic). Each half is one button: the player's photo and a name
// plate with the points a right call is worth. The chosen half fills with the player's colour (the
// --p1 violet / --p2 champagne of sides.ts), strongest at the net and fading toward the baseline, inside
// the court lines; the other half dims. No discs around players (a rounded photo tile instead).
import { useId } from "react";
import { useT } from "@/i18n/useT";
import type { Player } from "@/lib/api";
import { surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PlayerPhoto } from "./Brand";
import { SIDE_COLOR, type Side } from "./sides";

// Court geometry, top-down, in a 400 x 200 box: doubles 10–390 x 20–180, singles sidelines at 40/160,
// net at x = 200, service lines 98/302, centre service line at y = 100.
const C = { l: 10, r: 390, t: 20, b: 180, st: 40, sb: 160, net: 200, sl: 98, sr: 302, mid: 100 };

export function CourtPicker({
  players,
  names,
  points,
  base,
  winner,
  onPick,
}: {
  players: Record<Side, Player | undefined>;
  names: Record<Side, string>;
  points: Record<Side, number | null>;
  base: number;
  winner: Side | null;
  onPick: (side: Side) => void;
}) {
  const { t } = useT();
  const id = useId().replace(/:/g, "");
  const half = (side: Side) => {
    const on = winner === side;
    const off = winner !== null && !on;
    const pts = points[side];
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${names[side]}${pts !== null ? `, ${t("pts_if_right", { points: pts })}` : ""}`}
        onClick={() => onPick(side)}
        className={cn(
          "focus-ring relative z-10 flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 transition-opacity duration-300",
          off && "opacity-45",
        )}
      >
        <PlayerPhoto
          player={players[side]}
          size={56}
          className={cn(
            "rounded-xl ring-1 transition-shadow duration-300",
            on ? cn("ring-2", side === 1 ? "ring-p1" : "ring-p2") : "ring-white/25",
          )}
        />
        <span
          className={cn(
            "max-w-full rounded-lg bg-bg/80 px-2.5 py-1 text-center backdrop-blur-[2px] transition-colors",
            on && SIDE_COLOR[side].text,
          )}
        >
          <span className="headline block truncate text-lg leading-tight">
            {surname(names[side])}
          </span>
          {pts !== null && (
            <span className="block text-2xs text-ink-2">
              <b className="num text-ink">{pts}</b> {t("pts")}
              {pts > base && <span className="font-bold text-gold"> · {t("upset_bonus")}</span>}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <section>
      <p className="text-2xs font-bold uppercase tracking-wider text-ink-3">{t("pick_winner")}</p>
      <div className="relative mt-2 overflow-hidden rounded-2xl" style={{ aspectRatio: "2 / 1" }}>
        <svg
          aria-hidden
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full rtl:-scale-x-100"
        >
          <defs>
            {([1, 2] as const).map((s) => (
              <linearGradient
                key={s}
                id={`${id}-g${s}`}
                x1={s === 1 ? "1" : "0"}
                x2={s === 1 ? "0" : "1"}
                y1="0"
                y2="0"
              >
                <stop offset="0" style={{ stopColor: `var(--p${s})`, stopOpacity: 0.55 }} />
                <stop offset="1" style={{ stopColor: `var(--p${s})`, stopOpacity: 0.08 }} />
              </linearGradient>
            ))}
          </defs>
          {/* the run-off and the court surface */}
          <rect width="400" height="200" fill="#0d1a2e" />
          <rect x={C.l} y={C.t} width={C.r - C.l} height={C.b - C.t} fill="#14304f" />
          {/* the chosen half lights up, inside the lines */}
          {([1, 2] as const).map((s) => (
            <rect
              key={s}
              x={s === 1 ? C.l : C.net}
              y={C.t}
              width={C.net - C.l}
              height={C.b - C.t}
              fill={`url(#${id}-g${s})`}
              style={{ opacity: winner === s ? 1 : 0, transition: "opacity 300ms ease" }}
            />
          ))}
          <g fill="none" stroke="rgb(255 255 255 / 0.75)" strokeWidth="1.6">
            <rect x={C.l} y={C.t} width={C.r - C.l} height={C.b - C.t} />
            <line x1={C.l} x2={C.r} y1={C.st} y2={C.st} />
            <line x1={C.l} x2={C.r} y1={C.sb} y2={C.sb} />
            <line x1={C.sl} x2={C.sl} y1={C.st} y2={C.sb} />
            <line x1={C.sr} x2={C.sr} y1={C.st} y2={C.sb} />
            <line x1={C.sl} x2={C.sr} y1={C.mid} y2={C.mid} />
            <line x1={C.l} x2={C.l + 6} y1={C.mid} y2={C.mid} />
            <line x1={C.r - 6} x2={C.r} y1={C.mid} y2={C.mid} />
          </g>
          {/* the net, with its posts just outside the doubles lines */}
          <line x1={C.net} x2={C.net} y1={C.t - 8} y2={C.b + 8} stroke="#fff" strokeWidth="2.4" />
          <rect x={C.net - 2.5} y={C.t - 11} width="5" height="5" rx="1" fill="#d9d9d9" />
          <rect x={C.net - 2.5} y={C.b + 6} width="5" height="5" rx="1" fill="#d9d9d9" />
        </svg>
        <div className="absolute inset-0 flex">
          {half(1)}
          {half(2)}
        </div>
      </div>
      {winner === null && (
        <p className="mt-1.5 text-center text-2xs text-ink-3">{t("court_hint")}</p>
      )}
    </section>
  );
}
