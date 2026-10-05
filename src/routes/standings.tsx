// Standings: the global table and your friends leagues on one page (Tino, 4 Oct 2026: "build the
// merged Standings page"; it replaces Leaderboard and Leagues). Tabs on top: Global, one per league,
// and "+ League" (join with a code or create one, in a sheet). The table is the same for all of them:
// the global table filtered to the members, a podium for the top 3, "My rank ± 5",
// and your own row pinned while you scroll. A league tab adds its bar: who is in it, Invite, and
// Manage (the owner removes members or deletes the league) or Leave.
// Invite links are /standings?join=XXXXXX (the old /leagues?code= still works: it redirects here), and
// survive a detour through sign-in. Invite flow pattern from grand-slam-gm/src/routes/leagues.tsx.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { MEDAL, SponsorSlot } from "@/components/Brand";
import { QueryGate } from "@/components/QueryGate";
import { useEvent } from "@/config/eventConfig";
import { useAuth } from "@/hooks/useAuth";
import { errorText, useT } from "@/i18n/useT";
import { track } from "@/lib/analytics";
import {
  ApiError,
  createLeague,
  deleteLeague,
  joinLeague,
  leaderboardQuery,
  leagueMembersQuery,
  leaveLeague,
  myLeaguesQuery,
  rankWindowQuery,
  removeMember,
  type BoardRow,
  type League,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Search = { league?: string; view?: "top" | "me"; page?: number; join?: string };
const PAGE = 50;

export const Route = createFileRoute("/standings")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["league"] === "string" ? { league: s["league"] } : {}),
    ...(s["view"] === "me" ? { view: "me" as const } : {}),
    ...(Number(s["page"]) > 0 ? { page: Math.floor(Number(s["page"])) } : {}),
    ...(typeof s["join"] === "string"
      ? {
          join: s["join"]
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 6),
        }
      : {}),
  }),
  component: Standings,
});

const inviteLink = (code: string) => `${window.location.origin}/standings?join=${code}`;

function Standings() {
  const event = useEvent();
  const { t } = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate({ from: "/standings" });
  const qc = useQueryClient();
  const search = Route.useSearch();
  const league = search.league ?? null;
  const view = search.view ?? "top";
  const page = search.page ?? 1;
  const [sheet, setSheet] = useState(!!search.join);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leagues = useQuery({ ...myLeaguesQuery(user?.id ?? ""), enabled: !!user });
  const top = useQuery({
    ...leaderboardQuery(league, (page - 1) * PAGE, PAGE),
    enabled: !!user && view === "top",
  });
  const mine = useQuery({ ...rankWindowQuery(league), enabled: !!user });
  const active = view === "top" ? top : mine;
  const rows = active.data ?? [];
  const total = top.data?.[0]?.total ?? 0;
  const me = mine.data?.find((r) => r.is_me);
  const podium = view === "top" && page === 1 ? rows.slice(0, 3) : [];
  const table = view === "top" && page === 1 ? rows.slice(3) : rows;
  const current = (leagues.data ?? []).find((l) => l.id === league);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["leagues"] });
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["rank_window"] });
  };
  const closeSheet = useCallback(() => {
    setSheet(false);
    if (search.join) void navigate({ search: ({ join: _join, ...rest }) => rest, replace: true });
  }, [navigate, search.join]);

  if (!loading && !user) {
    return (
      <AppShell>
        <PageTitle title={t("board_title")} {...(search.join ? { sub: t("join_prompt") } : {})} />
        <Link
          to="/sign-in"
          search={search.join ? { code: search.join } : { redirect: "/standings" }}
          className="focus-ring mt-5 block rounded-full bg-accent py-3 text-center text-sm font-bold"
        >
          {t("sign_in")}
        </Link>
      </AppShell>
    );
  }

  const tabs = [
    { id: null as string | null, name: t("global") },
    ...(leagues.data ?? []).map((l) => ({ id: l.id as string | null, name: l.name })),
  ];
  const go = (s: Search) => void navigate({ search: { ...(league ? { league } : {}), ...s } });

  return (
    <AppShell>
      <PageTitle title={t("board_title")} />
      <SponsorSlot slot="leaderboard_header" className="mb-4" />

      {notice && (
        <p className="card mb-3 border-good/40 px-4 py-3 text-sm text-good" role="status">
          ✓ {notice}
        </p>
      )}
      {error && (
        <p className="card mb-3 px-4 py-3 text-sm text-accent-text" role="alert">
          {error}
        </p>
      )}

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id ?? "global"}
            role="tab"
            type="button"
            aria-selected={league === tab.id}
            onClick={() =>
              void navigate({ search: { ...(tab.id ? { league: tab.id } : {}), view } })
            }
            className={cn(
              "focus-ring max-w-[12rem] shrink-0 truncate rounded-full px-4 py-2 text-sm font-semibold",
              league === tab.id ? "bg-accent text-ink" : "bg-card text-ink-2",
            )}
          >
            {tab.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="focus-ring shrink-0 rounded-full border border-dashed border-ink-3/60 px-4 py-2 text-sm font-semibold text-ink-2"
        >
          + {t("add_league")}
        </button>
      </div>

      {current && (
        <LeagueBar
          league={current}
          onChange={() => {
            refresh();
            void navigate({ search: { view } });
          }}
          onRemoved={refresh}
          onError={(e) => setError(errorText(t, e))}
        />
      )}
      {league === null && (leagues.data ?? []).length === 0 && leagues.isSuccess && (
        <p className="mb-3 text-xs text-ink-3">{t("leagues_intro")}</p>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="grid grid-cols-2 rounded-full bg-card p-1 text-xs font-semibold">
          {(["top", "me"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => go({ view: v })}
              className={cn(
                "focus-ring rounded-full px-4 py-1.5",
                view === v ? "bg-raised text-ink" : "text-ink-3",
              )}
            >
              {t(v === "top" ? "top" : "my_rank")}
            </button>
          ))}
        </div>
        {view === "top" && total > PAGE && (
          <span className="text-xs text-ink-3">
            {t("page_of", { from: (page - 1) * PAGE + 1, to: Math.min(page * PAGE, total), total })}
          </span>
        )}
      </div>

      <QueryGate queries={[active]} label={t("board_title").toLowerCase()}>
        {rows.length === 0 ? (
          <p className="card px-4 py-6 text-center text-sm text-ink-3">{t("board_empty")}</p>
        ) : (
          <>
            {podium.length > 0 && <Podium rows={podium} />}
            <p className="mt-2 text-xs text-ink-3">{t("leagues_bragging")}</p>
            {table.length > 0 && <BoardTable rows={table} />}
            <p className="mt-2 text-2xs text-ink-3">{t("exact_key")}</p>
          </>
        )}
        {view === "top" && total > PAGE && (
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => go({ page: page - 1 })}
              className="focus-ring rounded-full bg-card px-4 py-2 text-xs font-semibold disabled:opacity-30"
            >
              ← {t("prev")}
            </button>
            <button
              type="button"
              disabled={page * PAGE >= total}
              onClick={() => go({ page: page + 1 })}
              className="focus-ring rounded-full bg-card px-4 py-2 text-xs font-semibold disabled:opacity-30"
            >
              {t("next")} →
            </button>
          </div>
        )}
      </QueryGate>

      {me && view === "top" && !rows.some((r) => r.is_me) && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-4">
          <div className="grid grid-cols-[2.5rem_1fr_3.5rem_3.5rem] items-center rounded-2xl border border-accent/50 bg-[#1f0c0d] px-3 py-2.5 text-sm shadow-[0_8px_30px_-10px_black]">
            <span className="num text-base">{me.pos}</span>
            <span className="truncate font-semibold">
              {t("you_cap")} · {me.display_name ?? "—"}
            </span>
            <span className="num text-end text-ink-3">{me.exact_sets}</span>
            <span className="num text-end text-base">{me.points}</span>
          </div>
        </div>
      )}

      {sheet && (
        <LeagueSheet
          initialCode={search.join ?? ""}
          onClose={closeSheet}
          onDone={(id, message) => {
            setError(null);
            setNotice(message);
            refresh();
            setSheet(false);
            void navigate({ search: { league: id, view } });
          }}
        />
      )}
    </AppShell>
  );
}

/** A league's bar under the tabs: who is in it, Invite, and Manage (owner) or Leave (member). */
function LeagueBar({
  league,
  onChange,
  onRemoved,
  onError,
}: {
  league: League;
  /** the league is gone for this fan (deleted, or left) */
  onChange: () => void;
  onRemoved: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useT();
  const [managing, setManaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const members = useQuery({
    ...leagueMembersQuery(league.id, league.member_count),
    enabled: managing,
  });

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
    <section className="card mb-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-ink-3">
          {league.member_count === 1 ? t("member_one") : t("members", { n: league.member_count })} ·{" "}
          {t("code")} <span className="num tracking-widest text-ink-2">{league.code}</span>
          {league.is_owner && ` · ${t("owner")}`}
        </p>
        <button
          type="button"
          onClick={share}
          className="focus-ring shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-bold"
        >
          {copied ? t("invite_copied") : t("invite")}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        {league.is_owner ? (
          <button
            type="button"
            aria-expanded={managing}
            className="focus-ring rounded text-ink-2 underline underline-offset-2"
            onClick={() => setManaging((m) => !m)}
          >
            {t("manage")}
          </button>
        ) : (
          <button
            type="button"
            className="focus-ring rounded text-ink-2 underline underline-offset-2"
            onClick={() =>
              window.confirm(t("confirm_leave", { name: league.name })) &&
              leaveLeague(league.id).then(onChange, onError)
            }
          >
            {t("leave")}
          </button>
        )}
      </div>

      {managing && (
        <div className="mt-3 border-t border-line pt-3">
          <ul className="space-y-1.5 text-sm">
            {(members.data ?? []).map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3">
                <span className="truncate">{m.display_name ?? "—"}</span>
                {!m.is_me && (
                  <button
                    type="button"
                    className="focus-ring shrink-0 rounded text-xs text-accent-text underline"
                    onClick={() =>
                      window.confirm(t("confirm_remove", { name: m.display_name ?? "" })) &&
                      removeMember(league.id, m.user_id).then(() => {
                        onRemoved();
                        void members.refetch();
                      }, onError)
                    }
                  >
                    {t("remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="focus-ring mt-3 rounded text-xs text-accent-text underline"
            onClick={() =>
              window.confirm(t("confirm_delete_league", { name: league.name })) &&
              deleteLeague(league.id).then(onChange, onError)
            }
          >
            {t("delete_league")}
          </button>
        </div>
      )}
    </section>
  );
}

/** "+ League": join with a code (an invite link fills it in) or create one. A bottom sheet. */
function LeagueSheet({
  initialCode,
  onClose,
  onDone,
}: {
  initialCode: string;
  onClose: () => void;
  onDone: (leagueId: string, message: string) => void;
}) {
  const { t } = useT();
  const panel = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const join = useMutation({
    mutationFn: async () => {
      const r = await joinLeague(code);
      if (!r.ok) throw new ApiError(r.error ?? "generic");
      return r;
    },
    onSuccess: (r) => {
      track("league_joined");
      onDone(r.league_id!, t("joined", { name: r.name ?? "" }));
    },
    onError: (e) => setError(errorText(t, e)),
  });
  const create = useMutation({
    mutationFn: () => createLeague(name.trim()),
    onSuccess: (l) => {
      track("league_created");
      onDone(l.id, `${l.name} · ${t("code")} ${l.code}`);
    },
    onError: (e) => setError(errorText(t, e)),
  });

  const input =
    "focus-ring h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-base";
  const btn =
    "focus-ring h-11 shrink-0 rounded-full bg-accent px-5 text-sm font-bold disabled:opacity-40";
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    fn();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("league_sheet_title")}
        className="safe-bottom relative w-full max-w-xl space-y-5 rounded-t-3xl border-t border-line bg-card px-4 pb-4 pt-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="headline text-2xl">{t("league_sheet_title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-raised text-lg text-ink-2"
          >
            ×
          </button>
        </div>
        {error && (
          <p className="text-sm text-accent-text" role="alert">
            {error}
          </p>
        )}
        <section>
          <h3 className="headline text-lg">{t("join_league")}</h3>
          {initialCode && <p className="mt-1 text-xs text-ink-2">{t("join_prompt")}</p>}
          <form onSubmit={submit(() => join.mutate())} className="mt-2 flex gap-2">
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
        <section>
          <h3 className="headline text-lg">{t("create_league")}</h3>
          <form onSubmit={submit(() => create.mutate())} className="mt-2 flex gap-2">
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
      </div>
    </div>
  );
}

function Podium({ rows }: { rows: BoardRow[] }) {
  const { t } = useT();
  // 2nd, 1st, 3rd: the winner in the middle, a step higher.
  const order = [rows[1], rows[0], rows[2]];
  return (
    <ol className="grid grid-cols-3 items-end gap-2" aria-label={t("top")}>
      {order.map((r, i) =>
        r ? (
          <li
            key={r.user_id}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-t-2xl rounded-b-md border bg-card px-2 pb-3 text-center",
              i === 1 ? "border-gold/70 pt-5" : "border-line pt-3",
              r.is_me && "bg-accent/10",
            )}
          >
            <span
              className={cn(
                "num flex h-7 w-7 items-center justify-center rounded-full text-xs text-bg",
                MEDAL[r.pos - 1] ?? "bg-raised",
              )}
            >
              {r.pos}
            </span>
            <span className="w-full truncate text-sm font-bold">
              {r.is_me ? t("you_cap") : (r.display_name ?? "—")}
            </span>
            <span className={cn("num", i === 1 ? "text-2xl" : "text-xl")}>{r.points}</span>
          </li>
        ) : (
          <li key={i} />
        ),
      )}
    </ol>
  );
}

function BoardTable({ rows }: { rows: BoardRow[] }) {
  const { t } = useT();
  return (
    <table className="mt-4 w-full text-sm">
      <thead>
        <tr className="text-2xs uppercase tracking-wider text-ink-3">
          <th className="w-12 py-2 text-start font-bold">{t("rank")}</th>
          <th className="py-2 text-start font-bold">{t("player_col")}</th>
          <th className="w-14 py-2 text-end font-bold">{t("exact_col")}</th>
          <th className="w-14 py-2 text-end font-bold">{t("points_col")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.user_id} className={cn("border-t border-line", r.is_me && "bg-accent/10")}>
            <td className="num py-2.5 text-ink-2">{r.pos}</td>
            <td className="max-w-0 truncate py-2.5 font-semibold">
              {r.display_name ?? "—"}
              {r.is_me && (
                <span className="ms-2 text-xs font-normal text-accent-text">· {t("you")}</span>
              )}
            </td>
            <td className="num py-2.5 text-end text-ink-3">{r.exact_sets}</td>
            <td className="num py-2.5 text-end text-base">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
