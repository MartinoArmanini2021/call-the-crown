// Friends leagues. Invite flow pattern from grand-slam-gm/src/routes/leagues.tsx: the invite link is
// /leagues?code=XXXXXX and survives a detour through sign-in.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { QueryGate } from "@/components/QueryGate";
import { useAuth } from "@/hooks/useAuth";
import { errorText, useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import {
  createLeague,
  deleteLeague,
  joinLeague,
  leaderboardQuery,
  leaveLeague,
  myLeaguesQuery,
  removeMember,
  ApiError,
  type League,
} from "@/lib/api";

type Search = { code?: string };
export const Route = createFileRoute("/leagues")({
  validateSearch: (s: Record<string, unknown>): Search =>
    typeof s["code"] === "string" ? { code: s["code"].toUpperCase().slice(0, 6) } : {},
  component: Leagues,
});

const inviteLink = (code: string) => `${window.location.origin}/leagues?code=${code}`;

function Leagues() {
  const { t } = useT();
  const { user, loading } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/leagues" });
  const qc = useQueryClient();
  const leagues = useQuery({ ...myLeaguesQuery(user?.id ?? ""), enabled: !!user });
  const [name, setName] = useState("");
  const [code, setCode] = useState(search.code ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["leagues"] });

  const create = useMutation({
    mutationFn: () => createLeague(name.trim()),
    onSuccess: (l) => {
      setName("");
      setError(null);
      track("league_created");
      setNotice(`${l.name} · ${t("code")} ${l.code}`);
      void refresh();
    },
    onError: (e) => setError(errorText(t, e)),
  });
  const join = useMutation({
    mutationFn: async () => {
      const r = await joinLeague(code);
      if (!r.ok) throw new ApiError(r.error ?? "generic");
      return r;
    },
    onSuccess: (r) => {
      setError(null);
      setCode("");
      track("league_joined");
      setNotice(t("joined", { name: r.name ?? "" }));
      void navigate({ search: {} });
      void refresh();
    },
    onError: (e) => setError(errorText(t, e)),
  });

  if (!loading && !user) {
    return (
      <AppShell>
        <PageTitle
          title={t("leagues_title")}
          sub={search.code ? t("join_prompt") : t("leagues_intro")}
        />
        <Link
          to="/sign-in"
          search={search.code ? { code: search.code } : { redirect: "/leagues" }}
          className="focus-ring block rounded-full bg-accent py-3 text-center text-sm font-bold"
        >
          {t("sign_in")}
        </Link>
      </AppShell>
    );
  }

  const input =
    "focus-ring h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-base";
  const btn =
    "focus-ring h-11 shrink-0 rounded-full bg-accent px-5 text-sm font-bold disabled:opacity-40";
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    fn();
  };

  return (
    <AppShell>
      <PageTitle title={t("leagues_title")} sub={t("leagues_intro")} />

      {notice && (
        <p className="card mb-4 border-good/40 px-4 py-3 text-sm text-good" role="status">
          ✓ {notice}
        </p>
      )}
      {error && (
        <p className="card mb-4 px-4 py-3 text-sm text-accent-text" role="alert">
          {error}
        </p>
      )}

      <section className="card mb-3 p-4">
        <h2 className="headline text-lg">{t("join_league")}</h2>
        {search.code && <p className="mt-1 text-xs text-ink-2">{t("join_prompt")}</p>}
        <form onSubmit={submit(() => join.mutate())} className="mt-3 flex gap-2">
          <input
            className={`${input} num uppercase tracking-[0.3em]`}
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 6),
              )
            }
            placeholder="ABC234"
            aria-label={t("league_code")}
            autoCapitalize="characters"
          />
          <button className={btn} disabled={code.length !== 6 || join.isPending}>
            {t("join")}
          </button>
        </form>
      </section>

      <section className="card mb-6 p-4">
        <h2 className="headline text-lg">{t("create_league")}</h2>
        <form onSubmit={submit(() => create.mutate())} className="mt-3 flex gap-2">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder={t("league_name")}
            aria-label={t("league_name")}
          />
          <button className={btn} disabled={!name.trim() || create.isPending}>
            {t("create")}
          </button>
        </form>
      </section>

      <QueryGate queries={[leagues]} label={t("leagues_title").toLowerCase()}>
        {(leagues.data ?? []).length === 0 ? (
          <p className="text-center text-sm text-ink-3">{t("no_leagues")}</p>
        ) : (
          <div className="space-y-3">
            {leagues.data!.map((l) => (
              <LeagueCard
                key={l.id}
                league={l}
                onChange={refresh}
                onError={(e) => setError(errorText(t, e))}
              />
            ))}
          </div>
        )}
      </QueryGate>
    </AppShell>
  );
}

function LeagueCard({
  league,
  onChange,
  onError,
}: {
  league: League;
  onChange: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useT();
  const [managing, setManaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const members = useQuery({ ...leaderboardQuery(league.id, 0, 100), enabled: managing });
  const run = (fn: () => Promise<unknown>) => fn().then(onChange, onError);

  async function share() {
    const url = inviteLink(league.code);
    try {
      if (navigator.share) await navigator.share({ title: league.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      track("invite_shared");
    } catch {
      /* the fan closed the share sheet */
    }
  }

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/leaderboard"
            search={{ league: league.id }}
            className="focus-ring headline block truncate rounded text-xl hover:text-accent-text"
          >
            {league.name}
          </Link>
          <p className="mt-0.5 text-xs text-ink-3">
            {league.member_count === 1 ? t("member_one") : t("members", { n: league.member_count })}{" "}
            · {t("code")} <span className="num tracking-widest text-ink-2">{league.code}</span>
            {league.is_owner && ` · ${t("owner")}`}
          </p>
        </div>
        <button
          type="button"
          onClick={share}
          className="focus-ring shrink-0 rounded-full bg-raised px-4 py-2 text-xs font-bold"
        >
          {copied ? t("invite_copied") : t("invite")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {league.is_owner ? (
          <>
            <button
              type="button"
              className="focus-ring rounded text-ink-2 underline"
              onClick={() => setManaging((m) => !m)}
            >
              {league.member_count === 1
                ? t("member_one")
                : t("members", { n: league.member_count })}
            </button>
            <button
              type="button"
              className="focus-ring rounded text-accent-text underline"
              onClick={() =>
                window.confirm(t("confirm_delete_league", { name: league.name })) &&
                run(() => deleteLeague(league.id))
              }
            >
              {t("delete_league")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="focus-ring rounded text-ink-2 underline"
            onClick={() =>
              window.confirm(t("confirm_leave", { name: league.name })) &&
              run(() => leaveLeague(league.id))
            }
          >
            {t("leave")}
          </button>
        )}
      </div>

      {managing && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {(members.data ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center justify-between">
              <span className="truncate">{m.display_name ?? "—"}</span>
              {!m.is_me && (
                <button
                  type="button"
                  className="focus-ring rounded text-xs text-accent-text underline"
                  onClick={() =>
                    window.confirm(t("confirm_remove", { name: m.display_name ?? "" })) &&
                    run(() => removeMember(league.id, m.user_id)).then(() => members.refetch())
                  }
                >
                  {t("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
