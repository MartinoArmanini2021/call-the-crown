import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, strings, type Locale, type StringKey } from "./strings";

type Vars = Record<string, string | number>;
type T = (key: StringKey, vars?: Vars) => string;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

const LocaleContext = createContext<{
  locale: Locale;
  languages: Locale[];
  setLocale: (l: Locale) => void;
  t: T;
}>({
  locale: "en",
  languages: ["en"],
  setLocale: () => {},
  t: (k, v) => fill(en[k], v),
});

const STORE = "locale";
// The fan's own choice if they made one; otherwise the phone's language (a phone set to Arabic opens
// in Arabic, one set to Italian in Italian, 13 Nov 2026). Only languages the event switched on count.
function stored(languages: Locale[]): Locale {
  let choice: string | null = null;
  try {
    choice = localStorage.getItem(STORE);
  } catch {
    /* storage blocked: fall through to the phone's language */
  }
  if (choice && (languages as string[]).includes(choice)) return choice as Locale;
  const phones =
    typeof navigator === "undefined"
      ? []
      : [...(navigator.languages ?? []), navigator.language ?? ""];
  for (const phone of phones) {
    const code = phone.toLowerCase().slice(0, 2);
    if ((languages as string[]).includes(code)) return code as Locale;
  }
  return "en";
}

// languages comes from event_config.flags (arabic, italian): English is always on.
/** Event-wide placeholders, per language, filled into every text unless the caller passes its own. */
export type EventVars = Partial<Record<Locale, Vars>>;
const NO_VARS: EventVars = {};

export function LocaleProvider({
  languages = ["en"],
  eventVars = NO_VARS,
  children,
}: {
  languages?: Locale[];
  eventVars?: EventVars;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<Locale>(() => stored(languages));
  const locale: Locale = languages.includes(chosen) ? chosen : "en";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setChosen(l);
    try {
      localStorage.setItem(STORE, l);
    } catch {
      /* private mode: the choice lasts this visit */
    }
  }, []);

  const t = useCallback<T>(
    (key, vars) => fill(strings[locale][key] ?? en[key], { ...eventVars[locale], ...vars }),
    [locale, eventVars],
  );
  const value = useMemo(
    () => ({ locale, languages, setLocale, t }),
    [locale, languages, setLocale, t],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useT = () => useContext(LocaleContext);

// Server error codes → sentences. Unknown codes get the generic message, never raw SQL text.
export function errorText(t: T, err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  const key = `err_${code}` as StringKey;
  return key in en ? t(key) : t("err_generic");
}
