import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { QueryGate } from "@/components/QueryGate";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { errorText, useT } from "@/i18n/useT";
import {
  consentsQuery,
  inLocale,
  deleteAccount,
  profileQuery,
  updateConsents,
  updateProfile,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({ component: Profile });

function Profile() {
  const event = useEvent();
  const { t, locale, setLocale } = useT();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ ...profileQuery(user?.id ?? ""), enabled: !!user });
  const consents = useQuery({ ...consentsQuery(user?.id ?? ""), enabled: !!user });

  const [name, setName] = useState("");
  const [org, setOrg] = useState(false);
  const [gsgm, setGsgm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");

  useEffect(() => setName(profile.data?.display_name ?? ""), [profile.data]);
  useEffect(() => {
    const latest = (party: string) =>
      [...(consents.data ?? [])].reverse().find((c) => c.party === party)?.granted ?? false;
    setOrg(latest("organiser"));
    setGsgm(latest("gsgm"));
  }, [consents.data]);

  if (!loading && !user) {
    return (
      <AppShell>
        <PageTitle title={t("profile_title")} />
        <Link
          to="/sign-in"
          className="focus-ring block rounded-full bg-accent py-3 text-center text-sm font-bold"
        >
          {t("sign_in")}
        </Link>
      </AppShell>
    );
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["consents"] });
    } catch (e) {
      setMsg({ ok: false, text: errorText(t, e) });
    }
  };

  const input =
    "focus-ring mt-1.5 h-11 w-full rounded-xl border border-line bg-raised px-3 text-base";

  return (
    <AppShell>
      <PageTitle title={t("profile_title")} sub={user?.email ?? ""} />
      {msg && (
        <p
          className={cn("card mb-4 px-4 py-3 text-sm", msg.ok ? "text-good" : "text-accent-text")}
          role="status"
        >
          {msg.text}
        </p>
      )}

      <QueryGate queries={[profile, consents]} label={t("profile_title").toLowerCase()}>
        <section className="card mb-3 p-4">
          <label className="block text-sm font-semibold">
            {t("display_name")}
            <input
              className={input}
              aria-label={t("display_name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
            />
          </label>
          <button
            type="button"
            className="focus-ring mt-3 h-10 rounded-full bg-accent px-5 text-sm font-bold"
            onClick={() => act(() => updateProfile(name), t("saved"))}
          >
            {t("save")}
          </button>
        </section>

        <section className="card mb-3 space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t("consents_title")}</h2>
          {[
            [org, setOrg, inLocale(event.privacy, "consent_organiser", locale)],
            [gsgm, setGsgm, inLocale(event.privacy, "consent_gsgm", locale)],
          ].map(([checked, set, text], i) => (
            <label key={i} className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
              <input
                type="checkbox"
                aria-label={text as string}
                checked={checked as boolean}
                onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
                className="focus-ring mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
              <span>{text as string}</span>
            </label>
          ))}
          <details className="text-xs text-ink-3">
            <summary className="focus-ring cursor-pointer rounded font-semibold text-ink-2">
              {t("privacy_title")}
            </summary>
            <p className="mt-2 whitespace-pre-line leading-relaxed">
              {inLocale(event.privacy, "notice", locale)}
            </p>
          </details>
          <button
            type="button"
            className="focus-ring h-10 rounded-full bg-raised px-5 text-sm font-bold"
            onClick={() =>
              act(
                () => updateConsents(org, gsgm, event.privacy.version ?? "unknown"),
                t("consents_saved"),
              )
            }
          >
            {t("save")}
          </button>
        </section>

        {event.flags.arabic && (
          <section className="card mb-3 flex items-center justify-between p-4">
            <span className="text-sm font-semibold">{t("language")}</span>
            <div className="flex gap-1">
              {(["en", "ar"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={locale === l}
                  onClick={() => {
                    setLocale(l);
                    void updateProfile(name, l);
                  }}
                  className={cn(
                    "focus-ring rounded-full px-4 py-1.5 text-sm",
                    locale === l ? "bg-accent" : "bg-raised",
                  )}
                >
                  {l === "en" ? "English" : "العربية"}
                </button>
              ))}
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={() => void signOut().then(() => navigate({ to: "/" }))}
          className="focus-ring card mb-8 w-full p-4 text-start text-sm font-semibold"
        >
          {t("sign_out")}
        </button>

        <section className="rounded-2xl border border-accent/40 p-4">
          <h2 className="text-sm font-bold text-accent-text">{t("delete_account")}</h2>
          <p className="mt-1 text-xs text-ink-2">{t("delete_account_body")}</p>
          <label className="mt-3 block text-xs text-ink-3">
            {t("delete_confirm_label")}
            <input
              className={input}
              aria-label={t("delete_confirm_label")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoCapitalize="characters"
            />
          </label>
          <button
            type="button"
            disabled={confirm !== "DELETE"}
            onClick={async () => {
              try {
                await deleteAccount();
                await supabase.auth.signOut();
                window.alert(t("account_deleted"));
                void navigate({ to: "/" });
              } catch (e) {
                setMsg({ ok: false, text: errorText(t, e) });
              }
            }}
            className="focus-ring mt-3 h-10 rounded-full bg-accent-deep px-5 text-sm font-bold disabled:opacity-30"
          >
            {t("delete_account")}
          </button>
        </section>
      </QueryGate>
    </AppShell>
  );
}
