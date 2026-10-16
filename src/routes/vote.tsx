// The quick vote (Tino, 15 Oct 2026: get Call the Crown out there today). "Who will win the Six Kings
// Slam?" (plain wording, 16 Oct; a line under it says the vote is independent of the event). One tap
// on one of the six players, no sign-up: a random id kept in this browser stands for the device
// (cast_quick_vote, 0052). After the tap: who you backed, how fans voted (percentages, only from 50
// votes), a Share button, and the way into the full game. Players are fixed here, as in 0052: the field
// changed on 6 Oct (Learner Tien replaces Jannik Sinner).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import { castQuickVote, quickVoteSharesQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vote")({ component: Vote });

const HEADSHOT = "https://www.atptour.com/-/media/alias/player-headshot/";
// ATP ranking of 5 Oct 2026 (the one in force until the Shanghai Masters ends), as in the draw file.
const PLAYERS = [
  { id: "alcaraz", name: "Carlos Alcaraz", ar: "كارلوس ألكاراز", rank: 3, atp: "A0E2" },
  { id: "zverev", name: "Alexander Zverev", ar: "ألكسندر زفيريف", rank: 2, atp: "Z355" },
  { id: "djokovic", name: "Novak Djokovic", ar: "نوفاك ديوكوفيتش", rank: 8, atp: "D643" },
  { id: "deminaur", name: "Alex de Minaur", ar: "أليكس دي مينور", rank: 9, atp: "DH58" },
  { id: "fritz", name: "Taylor Fritz", ar: "تايلور فريتز", rank: 12, atp: "FB98" },
  { id: "tien", name: "Learner Tien", ar: "ليرنر تيين", rank: 17, atp: "T0HA" },
] as const;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the vote still counts, this browser just forgets it */
  }
};
function deviceId(): string {
  const known = read("ctc_vote_device");
  if (known) return known;
  const id = crypto.randomUUID();
  write("ctc_vote_device", id);
  return id;
}

function Vote() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const shares = useQuery(quickVoteSharesQuery());
  const [choice, setChoice] = useState<string | null>(() => read("ctc_vote_choice"));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Players whose ATP photo did not load (ATP refuses its headshots to other sites from mid-October):
  // their tile shrinks to a name card instead of a big empty frame.
  const [noPhoto, setNoPhoto] = useState<ReadonlySet<string>>(new Set());
  const nameOf = (id: string) => {
    const p = PLAYERS.find((x) => x.id === id);
    return p ? (locale === "ar" ? p.ar : p.name) : "";
  };

  async function vote(id: string) {
    setBusy(id);
    setError(null);
    try {
      const result = await castQuickVote(deviceId(), id);
      setChoice(id);
      write("ctc_vote_choice", id);
      qc.setQueryData(quickVoteSharesQuery().queryKey, result);
      track("quick_vote", { player: id, changed: !!choice });
    } catch (e) {
      const m = String((e as { message?: string })?.message ?? e);
      setError(
        m.includes("voting_closed")
          ? t("vote_closed")
          : m.includes("too_many")
            ? t("vote_too_many")
            : t("vote_failed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const url = `${window.location.origin}/vote`;
    const text = choice
      ? t("vote_share_text", { name: nameOf(choice) })
      : t("vote_share_text_plain");
    try {
      if (navigator.share) {
        await navigator.share({ title: t("vote_title"), text, url });
        track("quick_vote_shared", { method: "share" });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track("quick_vote_shared", { method: "copy" });
    } catch {
      /* the fan closed the share sheet, or the clipboard was refused */
    }
  }

  const rows = shares.data ?? [];
  return (
    <AppShell>
      <section className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-ink-2">
          {t("vote_eyebrow")}
        </p>
        <h1 className="headline text-5xl sm:text-6xl">{t("vote_title")}</h1>
        <p className="text-sm text-ink-2">{t("vote_sub")}</p>
      </section>

      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t("vote_title")}>
        {PLAYERS.map((p) => {
          const mine = choice === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => vote(p.id)}
                disabled={busy !== null}
                aria-pressed={mine}
                className={cn(
                  "focus-ring relative flex w-full flex-col justify-end overflow-hidden rounded-2xl border bg-gradient-to-b from-raised to-card p-3 text-start transition",
                  noPhoto.has(p.id) ? "min-h-20" : "aspect-[4/5]",
                  mine ? "border-gold ring-2 ring-gold" : "border-line hover:border-ink-3",
                  busy === p.id && "opacity-60",
                )}
              >
                {!noPhoto.has(p.id) && (
                  <>
                    <img
                      src={HEADSHOT + p.atp}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={() => setNoPhoto((s) => new Set(s).add(p.id))}
                      className="absolute inset-0 h-full w-full object-cover object-top"
                    />
                    <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                  </>
                )}
                {mine && (
                  <span className="absolute end-2 top-2 rounded-full bg-gold px-2 py-0.5 text-2xs font-bold text-bg">
                    ♛
                  </span>
                )}
                <span className="headline relative text-lg leading-tight text-ink">
                  {locale === "ar" ? p.ar : p.name}
                </span>
                <span className="relative text-2xs text-ink-2">
                  {t("world_rank", { rank: p.rank })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-3 text-sm text-accent-text" role="alert">
          {error}
        </p>
      )}

      {choice && (
        <section className="card mt-4 space-y-3 px-4 py-4" aria-live="polite">
          <p className="text-base font-semibold">
            {t("vote_you_backed", { name: nameOf(choice) })}
          </p>
          <p className="text-xs text-ink-3">{t("vote_change")}</p>
          {rows.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-2xs font-bold uppercase tracking-wider text-ink-3">
                {t("vote_results_title")}
              </h2>
              {rows.map((r) => (
                <div
                  key={r.player_id}
                  className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-sm"
                >
                  <span className="truncate">{nameOf(r.player_id)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-raised">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        r.player_id === choice ? "bg-gold" : "bg-ink-3",
                      )}
                      style={{ width: `${Number(r.share)}%` }}
                    />
                  </span>
                  <span className="num text-end">{Number(r.share).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-2">{t("vote_results_after")}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={share}
              className="focus-ring h-11 rounded-full bg-gold px-5 text-sm font-bold text-bg"
            >
              {copied ? t("vote_copied") : t("vote_share")}
            </button>
            <Link
              to="/"
              className="focus-ring inline-flex h-11 items-center rounded-full border border-line px-5 text-sm font-semibold"
            >
              {t("vote_cta")}
            </Link>
          </div>
        </section>
      )}

      <p className="mt-6 text-2xs text-ink-3">{t("vote_independent")}</p>
    </AppShell>
  );
}
