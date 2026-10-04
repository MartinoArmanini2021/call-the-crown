// Picks, one match per screen (Tino, 4 Oct 2026: "1 pick in the screen and Pick 2 as another screen";
// then "make the pick change swap vertically"). A vertical deck: each match fills the
// deck, and you swipe up for the next one, like a feed. While you swipe,
// the card you leave shrinks and fades back as the next one rises in full size (the draw on Results is
// the flat sideways carousel; this is a different motion on purpose). Match tabs on top ("Fritz v
// Zverev ✓") show which you have picked and jump there. After a save it moves on to the next match you
// have not picked yet.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  /** one line above the tabs: how many are picked, the next lock */
  status?: ReactNode;
  render: (m: Match) => ReactNode;
};

export function PickPager({ matches, all, players, pickByMatch, focus, status, render }: Props) {
  const { t } = useT();
  const { title } = useMatchNames(players);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const slides = () => [...(track.current?.children ?? [])] as HTMLElement[];

  // Size the deck to the tallest card: one match fills it, and the next one waits just below its
  // edge (no empty screen to swipe through).
  useLayoutEffect(() => {
    const fit = () => {
      const tallest = Math.max(
        0,
        ...slides().map((el) => (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0),
      );
      if (tallest > 0) setHeight(tallest + 12);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [matches.length]);

  // The deck effect: each card's scale and opacity follow how far it is from the middle.
  const paint = useCallback(() => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.height === 0) return;
    let best = 0;
    let nearest = Infinity;
    slides().forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const off = Math.min(
        1,
        Math.abs(r.top + r.height / 2 - (box.top + box.height / 2)) / box.height,
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
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) box.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Open on the requested match; when it changes (a save moves on), slide there.
  const focusIndex = Math.max(
    0,
    matches.findIndex((m) => m.match_no === focus),
  );
  useEffect(() => {
    if (height === null) return;
    goTo(focusIndex, false);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex, matches.length, height]);

  const header = (
    <>
      {status && <div className="mb-2 text-sm">{status}</div>}
      {matches.length > 1 && (
        <div
          className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      )}
    </>
  );

  if (matches.length === 1)
    return (
      <div>
        {header}
        {render(matches[0]!)}
      </div>
    );

  return (
    <div>
      {header}
      <div
        ref={track}
        onScroll={() => requestAnimationFrame(paint)}
        style={height !== null ? { height } : undefined}
        className="-mx-4 snap-y snap-mandatory overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {matches.map((m) => (
          <div
            key={m.match_no}
            className="snap-start snap-always px-4"
            style={height !== null ? { height } : undefined}
          >
            <div className="origin-top will-change-transform">{render(m)}</div>
          </div>
        ))}
      </div>
      <p
        className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-3"
        aria-live="polite"
      >
        <span>{t("pager_count", { n: index + 1, total: matches.length })}</span>
        {index < matches.length - 1 && (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            className="focus-ring rounded-full bg-card px-3 py-1 font-semibold text-ink-2"
          >
            {t("pager_swipe")} ↓
          </button>
        )}
      </p>
    </div>
  );
}
