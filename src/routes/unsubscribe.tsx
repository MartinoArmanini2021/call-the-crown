// The unsubscribe link in a reminder email (brief "bragging rights", Phase 5): one button. Opening the
// page changes nothing (mail scanners open every link); the button POSTs the user id and token from the
// link to the edge function reminder-unsubscribe, which checks the token and turns reminders off.
// Works signed out: the token is the proof.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { instance } from "@/config/instance";
import { useT } from "@/i18n/useT";

type Search = { u?: string; t?: string };

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["u"] === "string" ? { u: s["u"] } : {}),
    ...(typeof s["t"] === "string" ? { t: s["t"] } : {}),
  }),
  component: Unsubscribe,
});

function Unsubscribe() {
  const { t } = useT();
  const { u, t: token } = Route.useSearch();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function turnOff() {
    if (!u || !token) return setState("failed");
    setState("busy");
    try {
      const q = new URLSearchParams({ u, t: token });
      const res = await fetch(`${instance.supabaseUrl}/functions/v1/reminder-unsubscribe?${q}`, {
        method: "POST",
      });
      setState(res.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <AppShell>
      <PageTitle title={t("unsub_title")} />
      {state === "done" ? (
        <p className="card px-4 py-4 text-sm font-semibold text-good" role="status">
          ✓ {t("unsub_done")}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={turnOff}
            disabled={state === "busy"}
            className="focus-ring h-12 w-full rounded-full bg-gold text-sm font-bold text-bg disabled:opacity-40"
          >
            {t("unsub_button")}
          </button>
          {state === "failed" && (
            <p className="mt-3 text-sm text-accent-text" role="alert">
              {t("err_generic")}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
