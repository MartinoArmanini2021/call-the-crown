// Picks, one match per screen (Tino, 4 Oct 2026: "1 pick in the screen and Pick 2 as another screen you
// can access, similar to the draw page but with a different slide dynamic"). The draw on Results is a
// flat carousel with the next column peeking in; this is a deck: each match fills the width, and while
// you swipe the card you leave shrinks and fades back as the next one slides in full size. Match tabs on
// top ("Fritz v Zverev ✓") show which you have picked and jump there; arrows do the same on a desktop.
// After a save it moves on to the next match you have not picked yet.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMatchNames } from "./matchNames";

type Props = {
  matches: Match[];
  all: Match[];
  players: Map<string, Player>;
  pickByMatch: Map<number, Pick>;
  /** the match to show first (a deep link, or the next one to pick) */
  focus?: number | undefined;
  render: (m: Match) => ReactNode;
};

export function PickPager({ matches, all, players, pickByMatch, focus, render }: Props) {
  const { t } = useT();
  const { title } = useMatchNames(players);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const slides = () => [...(track.current?.children ?? [])] as HTMLElement[];

  // The deck effect: each slide's scale and opacity follow how far it is from the centre.
  const paint = useCallback(() => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    let best = 0;
    let nearest = Infinity;
    slides().forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const off = Math.min(
        1,
        Math.abs(r.left + r.width / 2 - (box.left + box.width / 2)) / box.width,
      );
      const card = el.firstElementChild as HTMLElement | null;
      if (card) {
        card.style.transform = `scale(${1 - 0.12 * off})`;
        card.style.opacity = String(1 - 0.6 * off);
      }
      if (off < nearest) [best, nearest] = [i, off];
    });
    setIndex(best);
  }, []);

  const goTo = useCallback((i: number, smooth = true) => {
    const box = track.current;
    const el = slides()[i];
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    box.scrollBy({ left: r.left - b.left, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Open on the requested match; when it changes (a save moves on), slide there.
  const focusIndex = Math.max(
    0,
    matches.findIndex((m) => m.match_no === focus),
  );
  useEffect(() => {
    goTo(focusIndex, false);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex, matches.length]);

  if (matches.length === 1) return <>{render(matches[0]!)}</>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label={t("open_now")}
        >
          {matches.map((m, i) => (
            <button
              key={m.match_no}
              type="button"
              role="tab"
              aria-selected={index === i}
              onClick={() => goTo(i)}
              className={cn(
                "focus-ring shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                index === i ? "bg-ink text-bg" : "bg-card text-ink-2",
              )}
            >
              {pickByMatch.has(m.match_no) && (
                <span className={index === i ? "text-bg" : "text-good"}>✓ </span>
              )}
              {title(m, all)}
            </button>
          ))}
        </div>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          <Arrow label={t("pager_prev")} disabled={index === 0} onClick={() => goTo(index - 1)}>
            ‹
          </Arrow>
          <Arrow
            label={t("pager_next")}
            disabled={index === matches.length - 1}
            onClick={() => goTo(index + 1)}
          >
            ›
          </Arrow>
        </div>
      </div>

      <div
        ref={track}
        onScroll={() => requestAnimationFrame(paint)}
        className="-mx-4 flex snap-x snap-mandatory items-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {matches.map((m) => (
          <div key={m.match_no} className="w-full shrink-0 snap-center snap-always px-4">
            <div className="origin-center transition-[opacity] will-change-transform">
              {render(m)}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-ink-3" aria-live="polite">
        {t("pager_count", { n: index + 1, total: matches.length })}
      </p>
    </div>
  );
}

function Arrow({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring flex h-8 w-8 items-center justify-center rounded-full bg-card text-lg text-ink-2 disabled:opacity-30 rtl:rotate-180"
    >
      {children}
    </button>
  );
}
