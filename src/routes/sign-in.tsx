// Joining: a 6-digit email code proves the address once, then the fan chooses a password. Every
// later sign-in: email + password (Tino, 3 Oct 2026: "email verification only once, then a password").
// "Forgot your password?" signs in with a code instead and offers a new password, so nobody is locked
// out. No magic links (they break inside in-app browsers), no social sign-in. "Join" creates the
// account with the display name and the two unticked consents, each stored server-side with the
// version of the text shown (handle_new_user, 0005_user_rpcs.sql).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState, type FormEvent } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Turnstile, turnstileEnabled } from "@/components/Turnstile";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import { inLocale } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Search = { redirect?: string; code?: string };

export const Route = createFileRoute("/sign-in")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
    ...(typeof s["code"] === "string" ? { code: s["code"] } : {}),
  }),
  component: SignIn,
});

// Only same-site paths: "//evil.com" and "https://…" are refused. From grand-slam-gm/src/routes/auth.tsx.
const safeRedirect = (r: string | undefined) =>
  r && r.startsWith("/") && !r.startsWith("//") ? r : "/picks";

function SignIn() {
  const event = useEvent();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [mode, setMode] = useState<"join" | "signin">("join");
  // signin + useCode: the "forgot your password" path (a code instead of the password)
  const [useCode, setUseCode] = useState(false);
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consentOrg, setConsentOrg] = useState(false);
  const [consentGsgm, setConsentGsgm] = useState(false);
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onToken = useCallback((tok: string | null) => setCaptcha(tok), []);

  const authError = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes("signups not allowed") || m.includes("user not found")) return t("no_account");
    if (m.includes("rate") || m.includes("too many")) return t("too_many_requests");
    if (m.includes("invalid login credentials")) return t("wrong_password");
    if (m.includes("weak") || m.includes("pwned") || m.includes("known")) return t("password_weak");
    if (m.includes("expired") || m.includes("invalid")) return t("code_wrong");
    return t("err_generic");
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (turnstileEnabled() && !captcha) return setError(t("captcha_needed"));
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: mode === "join",
        ...(captcha ? { captchaToken: captcha } : {}),
        ...(mode === "join"
          ? {
              data: {
                display_name: name.trim(),
                locale,
                consent_organiser: consentOrg,
                consent_gsgm: consentGsgm,
                consent_text_version: event.privacy.version ?? "unknown",
              },
            }
          : {}),
      },
    });
    setBusy(false);
    if (err) return setError(authError(err.message));
    setStep("code");
  }

  const done = () => {
    const to = search.code
      ? `/leagues?code=${encodeURIComponent(search.code)}`
      : safeRedirect(search.redirect);
    void navigate({ to });
  };

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    if (turnstileEnabled() && !captcha) return setError(t("captcha_needed"));
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      ...(captcha ? { options: { captchaToken: captcha } } : {}),
    });
    setBusy(false);
    if (err) return setError(authError(err.message));
    track("signed_in", { method: "password" });
    done();
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError(t("password_too_short"));
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(authError(err.message));
    track("password_set");
    done();
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (err) return setError(authError(err.message));
    track(mode === "join" ? "signed_up" : "signed_in", { method: "code" });
    // The email is proven: now the password for every later sign-in (a new one after "forgot").
    setPassword("");
    setStep("password");
  }

  const input =
    "focus-ring mt-1.5 h-12 w-full rounded-xl border border-line bg-raised px-4 text-base text-ink placeholder:text-ink-3";
  const nameOk = name.trim().length >= 2 && name.trim().length <= 24;
  const withPassword = mode === "signin" && !useCode;

  const passwordInput = (purpose: "current" | "new") => (
    <label className="block text-sm font-semibold">
      {t(purpose === "new" ? "password_new" : "password")}
      <span className="relative mt-1.5 block">
        <input
          className={cn(input, "mt-0 pe-20")}
          type={showPassword ? "text" : "password"}
          aria-label={t(purpose === "new" ? "password_new" : "password")}
          autoComplete={purpose === "new" ? "new-password" : "current-password"}
          minLength={purpose === "new" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus={purpose === "new"}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="focus-ring absolute inset-y-0 end-2 my-auto h-8 rounded-full px-3 text-xs font-semibold text-ink-2"
        >
          {t(showPassword ? "password_hide" : "password_show")}
        </button>
      </span>
      {purpose === "new" && (
        <span className="mt-1 block text-xs font-normal text-ink-3">{t("password_hint")}</span>
      )}
    </label>
  );

  return (
    <AppShell>
      <PageTitle title={t("sign_in")} />

      {step === "email" ? (
        <>
          <div
            className="mb-5 grid grid-cols-2 rounded-full bg-card p-1 text-sm font-semibold"
            role="tablist"
          >
            {(["join", "signin"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setUseCode(false);
                  setError(null);
                }}
                className={cn(
                  "focus-ring h-10 rounded-full",
                  mode === m ? "bg-accent text-ink" : "text-ink-2",
                )}
              >
                {t(m === "join" ? "join_tab" : "signin_tab")}
              </button>
            ))}
          </div>

          <form onSubmit={withPassword ? signInWithPassword : sendCode} className="space-y-4">
            {mode === "join" && (
              <label className="block text-sm font-semibold">
                {t("display_name")}
                <input
                  className={input}
                  aria-label={t("display_name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  required
                />
                <span className="mt-1 block text-xs font-normal text-ink-3">
                  {t("display_name_hint")}
                </span>
              </label>
            )}
            <label className="block text-sm font-semibold">
              {t("email")}
              <input
                className={input}
                type="email"
                aria-label={t("email")}
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            {mode === "join" && (
              <fieldset className="card space-y-3 p-4">
                <legend className="sr-only">{t("consents_title")}</legend>
                <p className="text-sm font-semibold">{t("consents_title")}</p>
                <Consent
                  checked={consentOrg}
                  onChange={setConsentOrg}
                  text={inLocale(event.privacy, "consent_organiser", locale) ?? ""}
                />
                <Consent
                  checked={consentGsgm}
                  onChange={setConsentGsgm}
                  text={inLocale(event.privacy, "consent_gsgm", locale) ?? ""}
                />
                <details className="text-xs text-ink-3">
                  <summary className="focus-ring cursor-pointer rounded font-semibold text-ink-2">
                    {t("privacy_title")}
                  </summary>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">
                    {inLocale(event.privacy, "notice", locale)}
                  </p>
                </details>
              </fieldset>
            )}

            {withPassword && passwordInput("current")}

            <Turnstile onToken={onToken} />
            {error && (
              <p className="text-sm text-accent-text" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || (mode === "join" && !nameOk)}
              className="focus-ring h-12 w-full rounded-full bg-accent text-sm font-bold disabled:opacity-40"
            >
              {withPassword ? t("verify") : t("send_code")}
            </button>
            {mode === "signin" && (
              <p className="text-center text-xs">
                <button
                  type="button"
                  className="focus-ring rounded text-ink-2 underline"
                  onClick={() => {
                    setUseCode((v) => !v);
                    setError(null);
                  }}
                >
                  {t(useCode ? "use_password" : "forgot_password")}
                </button>
              </p>
            )}
          </form>
        </>
      ) : step === "password" ? (
        <form onSubmit={savePassword} className="space-y-4">
          <p className="text-sm text-ink-2">
            {t(mode === "join" ? "password_new_sub" : "password_reset_sub")}
          </p>
          {passwordInput("new")}
          {error && (
            <p className="text-sm text-accent-text" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || password.length < 8}
            className="focus-ring h-12 w-full rounded-full bg-accent text-sm font-bold disabled:opacity-40"
          >
            {t("password_save")}
          </button>
          {mode === "signin" && (
            <p className="text-center text-xs">
              <button
                type="button"
                className="focus-ring rounded text-ink-2 underline"
                onClick={done}
              >
                {t("not_now")}
              </button>
            </p>
          )}
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-ink-2">{t("code_sent", { email: email.trim() })}</p>
          <label className="block text-sm font-semibold">
            {t("code_label")}
            <input
              className={cn(input, "num text-center text-2xl tracking-[0.5em]")}
              inputMode="numeric"
              aria-label={t("code_label")}
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
          </label>
          {error && (
            <p className="text-sm text-accent-text" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="focus-ring h-12 w-full rounded-full bg-accent text-sm font-bold disabled:opacity-40"
          >
            {t("verify")}
          </button>
          <div className="flex justify-between text-xs">
            <button
              type="button"
              className="focus-ring rounded text-ink-2 underline"
              onClick={() => setStep("email")}
            >
              {t("change_email")}
            </button>
            <button
              type="button"
              className="focus-ring rounded text-ink-2 underline"
              onClick={() => void sendCode()}
              disabled={busy}
            >
              {t("resend")}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}

function Consent({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
      <input
        type="checkbox"
        aria-label={text}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
      />
      <span>{text}</span>
    </label>
  );
}
