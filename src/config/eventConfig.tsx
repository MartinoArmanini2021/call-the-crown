import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { eventConfigQuery, type EventConfig } from "@/lib/api";
import { LocaleProvider } from "@/i18n/useT";

// The event's brand, rules and texts, loaded once at boot from event_config. Brand colours
// are written onto the CSS variables in src/styles.css, so every component re-skins with no code.
const EventContext = createContext<EventConfig | null>(null);

const COLOR_VARS: Record<string, string> = {
  bg: "--bg",
  card: "--card",
  raised: "--raised",
  accent: "--accent",
  accent_deep: "--accent-deep",
  accent_text: "--accent-text",
  text: "--text",
  text_secondary: "--text-2",
  text_muted: "--text-3",
  p1: "--p1",
  p2: "--p2",
};
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

export function EventProvider({ children }: { children: ReactNode }) {
  const q = useQuery(eventConfigQuery);
  const config = q.data ?? null;

  useEffect(() => {
    if (!config) return;
    const root = document.documentElement.style;
    for (const [key, value] of Object.entries(config.branding.colors ?? {})) {
      const cssVar = COLOR_VARS[key];
      if (cssVar && value && SAFE_COLOR.test(value)) root.setProperty(cssVar, value);
    }
    document.title = config.branding.app_name ?? config.name; // the English name; the page title is not localised
    const bg = config.branding.colors?.["bg"];
    if (bg && SAFE_COLOR.test(bg))
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  }, [config]);

  if (q.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="headline text-3xl">Unavailable</p>
          <p className="mt-2 text-sm text-ink-3">
            The game could not be loaded. Please try again shortly.
          </p>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="focus-ring mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!config) return <div className="min-h-dvh" aria-busy="true" />;

  return (
    <EventContext.Provider value={config}>
      <LocaleProvider arabicEnabled={config.flags.arabic === true}>{children}</LocaleProvider>
    </EventContext.Provider>
  );
}

export function useEvent(): EventConfig {
  const c = useContext(EventContext);
  if (!c) throw new Error("useEvent outside EventProvider");
  return c;
}
