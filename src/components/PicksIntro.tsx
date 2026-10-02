import { useState } from "react";
import { useT } from "@/i18n/useT";

const KEY = "skg_picks_intro_seen";

// Three steps the first time a fan opens Picks (first-time-fan test, 2 Oct 2026). Remembered in this
// browser only, a convenience: if storage is blocked it simply shows again.
function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function PicksIntro() {
  const { t } = useT();
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: hide for this visit only
    }
    setOpen(false);
  };
  const steps = [
    [t("intro_1"), t("intro_1_sub")],
    [t("intro_2"), t("intro_2_sub")],
    [t("intro_3"), t("intro_3_sub")],
  ];
  return (
    <section className="card mb-4 px-4 py-4" aria-labelledby="intro-title">
      <h2 id="intro-title" className="headline text-lg">
        {t("intro_title")}
      </h2>
      <ol className="mt-3 grid gap-2.5">
        {steps.map(([title, sub], i) => (
          <li key={title} className="grid grid-cols-[26px_1fr] items-start gap-2.5 text-sm">
            <span className="num grid h-[26px] w-[26px] place-items-center rounded-full bg-accent text-xs">
              {i + 1}
            </span>
            <span>
              <b className="block">{title}</b>
              <span className="text-xs text-ink-2">{sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={dismiss}
        className="focus-ring mt-3 h-10 w-full rounded-full bg-raised text-sm font-bold"
      >
        {t("intro_ok")}
      </button>
    </section>
  );
}
