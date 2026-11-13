// "A new version is ready · Refresh" (UX review, 13 Nov 2026): for a fan who keeps the home-screen app
// open for days. Checked when the page comes back into view, at most every 10 minutes
// (src/lib/updateCheck.ts). It only offers: the page never reloads by itself, so a pick being typed is
// never lost.
import { useEffect, useState } from "react";
import { useT } from "@/i18n/useT";
import { CHECK_EVERY_MS, newVersionLive, runningScript } from "@/lib/updateCheck";

export function UpdateBar() {
  const { t } = useT();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const running = runningScript(document);
    if (!running) return; // development: no built script to compare
    let last = Date.now(); // the page was just loaded: it is the newest for now
    let busy = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      if (Date.now() - last < CHECK_EVERY_MS) return;
      busy = true;
      last = Date.now();
      if (await newVersionLive(running)) setReady(true);
      busy = false;
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (!ready || dismissed) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-[calc(4.25rem+env(safe-area-inset-top))] z-30 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-full border border-accent/50 bg-card py-1 pe-1 ps-4 text-sm shadow-lg sm:top-[calc(5.25rem+env(safe-area-inset-top))]"
    >
      <span className="min-w-0 flex-1 truncate text-ink-2">{t("update_ready")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="focus-ring h-9 shrink-0 rounded-full bg-accent px-4 text-sm font-bold"
      >
        {t("update_refresh")}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("close")}
        className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-ink-3 hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
