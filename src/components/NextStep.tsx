import { Link } from "@tanstack/react-router";
import { useT } from "@/i18n/useT";
import type { Match } from "@/lib/api";
import { shortTimeLeft } from "@/lib/format";
import type { NextStep } from "@/lib/nextStep";
import { useMatchLabel } from "./MatchCard";

/**
 * The one thing to do next (lib/nextStep). On Picks, "Pick …" opens the pick sheet (`onPick`); on
 * Results there is no `onPick`, so it links to Picks.
 */
export function NextStepBanner({
  step,
  matches,
  onPick,
}: {
  step: NextStep;
  matches: Match[];
  onPick?: (m: Match) => void;
}) {
  const { t } = useT();
  const label = useMatchLabel();
  const row = "flex items-center justify-between gap-3 px-4 py-3";
  const box = `card ${row}`;
  const kicker = "text-[11px] font-bold uppercase tracking-wider";

  switch (step.kind) {
    case "pick": {
      const body = (
        <>
          <span className="min-w-0">
            <span className={`${kicker} block text-accent-text`}>{t("next_step")}</span>
            <span className="headline block truncate text-xl">
              {t("next_pick", { match: label(step.match, matches) })} →
            </span>
          </span>
          <span className="num shrink-0 text-end text-sm text-ink-2">
            {t("time_left", { time: shortTimeLeft(step.msLeft) })}
          </span>
        </>
      );
      // not .card: its unlayered border and background would beat these utilities
      const hot = `${row} focus-ring w-full rounded-2xl border border-accent/50 bg-gradient-to-r from-accent/25 to-accent/5 text-start`;
      return onPick ? (
        <button type="button" onClick={() => onPick(step.match)} className={hot}>
          {body}
        </button>
      ) : (
        <Link to="/picks" className={hot}>
          {body}
        </Link>
      );
    }
    case "all_set":
      return (
        <div className={box}>
          <span>
            <span className={`${kicker} block text-good`}>✓ {t("all_set")}</span>
            <span className="mt-0.5 block text-sm text-ink-2">{t("all_set_sub")}</span>
          </span>
          <span className="shrink-0 text-end">
            <span className={`${kicker} block text-ink-3`}>{t("next_lock")}</span>
            <span className="num text-xl text-accent-text">{shortTimeLeft(step.msLeft)}</span>
          </span>
        </div>
      );
    case "waiting":
      return (
        <div className={box}>
          <span>
            <span className={`${kicker} block text-ink-3`}>{t("up_next")}</span>
            <span className="mt-0.5 block text-sm font-semibold">
              {t("opens_after", {
                match: label(step.match, matches),
                after: label(step.after, matches),
              })}
            </span>
          </span>
        </div>
      );
    case "over":
      return (
        <Link to="/leaderboard" className={`${box} focus-ring`}>
          <span>
            <span className={`${kicker} block text-ink-3`}>{t("event_over")}</span>
            <span className="mt-0.5 block text-sm font-semibold">{t("see_standings")} →</span>
          </span>
        </Link>
      );
    default:
      return null;
  }
}
