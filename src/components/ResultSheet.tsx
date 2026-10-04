// A finished (or in-play) match, opened from its card in the draw (Tino, 4 Oct 2026: Results no longer
// lists the finished matches again under the draw; tapping a draw card opens that result). The same
// bottom sheet as the pick sheet: Escape or a tap outside closes it, Tab stays inside, focus returns.
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/useT";
import type { Match, Pick, Player } from "@/lib/api";
import { ResultCard } from "./ResultCard";

export function ResultSheet({
  match,
  matches,
  pick,
  players,
  signedIn,
  onClose,
}: {
  match: Match;
  matches: Match[];
  pick: Pick | undefined;
  players: Map<string, Player>;
  signedIn: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

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
        aria-label={t("results_title")}
        className="safe-bottom relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl border-t border-line bg-bg"
      >
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-full bg-raised px-4 text-sm font-semibold"
          >
            {t("close")}
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4 pt-2">
          <ResultCard
            match={match}
            matches={matches}
            pick={pick}
            players={players}
            signedIn={signedIn}
          />
        </div>
      </div>
    </div>
  );
}
