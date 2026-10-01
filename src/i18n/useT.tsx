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

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: T }>({
  locale: "en",
  setLocale: () => {},
  t: (k, v) => fill(en[k], v),
});

const STORE = "locale";
function stored(): Locale {
  try {
    return localStorage.getItem(STORE) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

// arabicEnabled comes from event_config.flags.arabic: when it is off, the app is English only.
export function LocaleProvider({
  arabicEnabled,
  children,
}: {
  arabicEnabled: boolean;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<Locale>(stored);
  const locale: Locale = arabicEnabled ? chosen : "en";

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

  const t = useCallback<T>((key, vars) => fill(strings[locale][key] ?? en[key], vars), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useT = () => useContext(LocaleContext);

// Server error codes → sentences. Unknown codes get the generic message, never raw SQL text.
export function errorText(t: T, err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  const key = `err_${code}` as StringKey;
  return key in en ? t(key) : t("err_generic");
}
