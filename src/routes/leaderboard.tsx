import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { PrizeStrip, SponsorSlot } from "@/components/Brand";
import { QueryGate } from "@/components/QueryGate";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/i18n/useT";
import { leaderboardQuery, myLeaguesQuery, rankWindowQuery, type BoardRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type Search = { league?: string; view?: "top" | "me"; page?: number };
const PAGE = 50;

export const Route = createFileRoute("/leaderboard")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["league"] === "string" ? { league: s["league"] } : {}),
    ...(s["view"] === "me" ? { view: "me" as const } : {}),
    ...(Number(s["page"]) > 0 ? { page: Math.floor(Number(s["page"])) } : {}),
  }),
  component: Leaderboard,
});

function Leaderboard() {
  const { t } = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate({ from: "/leaderboard" });
  const search = Route.useSearch();
  const league = search.league ?? null;
  const view = search.view ?? "top";
  const page = search.page ?? 1;

  const leagues = useQuery({ ...myLeaguesQuery(user?.id ?? ""), enabled: !!user });
  const top = useQuery({
    ...leaderboardQuery(league, (page - 1) * PAGE, PAGE),
    enabled: !!user && view === "top",
  });
  const mine = useQuery({ ...rankWindowQuery(league), enabled: !!user && view === "me" });
  const active = view === "top" ? top : mine;
  const rows = active.data ?? [];
  const total = top.data?.[0]?.total ?? 0;

  if (!loading && !user) {
    return (
      <AppShell>
        <PageTitle title={t("board_title")} />
        <PrizeStrip />
        <Link
          to="/sign-in"
          search={{ redirect: "/leaderboard" }}
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

  return (
    <AppShell>
      <PageTitle title={t("board_title")} />
      <SponsorSlot slot="leaderboard_header" className="mb-4" />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
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
              "focus-ring shrink-0 rounded-full px-4 py-2 text-sm font-semibold",
              league === tab.id ? "bg-accent text-ink" : "bg-card text-ink-2",
            )}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {league === null ? (
        <PrizeStrip compact />
      ) : (
        <p className="text-xs text-ink-3">{t("friends_no_prizes")}</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="grid grid-cols-2 rounded-full bg-card p-1 text-xs font-semibold">
          {(["top", "me"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => void navigate({ search: { ...(league ? { league } : {}), view: v } })}
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
          <p className="card mt-3 px-4 py-6 text-center text-sm text-ink-3">{t("board_empty")}</p>
        ) : (
          <>
            <BoardTable rows={rows} />
            <p className="mt-2 text-[11px] text-ink-3">{t("exact_key")}</p>
          </>
        )}
        {view === "top" && total > PAGE && (
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() =>
                void navigate({ search: { ...(league ? { league } : {}), page: page - 1 } })
              }
              className="focus-ring rounded-full bg-card px-4 py-2 text-xs font-semibold disabled:opacity-30"
            >
              ← {t("prev")}
            </button>
            <button
              type="button"
              disabled={page * PAGE >= total}
              onClick={() =>
                void navigate({ search: { ...(league ? { league } : {}), page: page + 1 } })
              }
              className="focus-ring rounded-full bg-card px-4 py-2 text-xs font-semibold disabled:opacity-30"
            >
              {t("next")} →
            </button>
          </div>
        )}
      </QueryGate>
    </AppShell>
  );
}

function BoardTable({ rows }: { rows: BoardRow[] }) {
  const { t } = useT();
  const medal = (pos: number) =>
    pos === 1
      ? "bg-accent"
      : pos === 2
        ? "bg-accent-deep"
        : pos === 3
          ? "bg-raised ring-1 ring-accent/60"
          : "";
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-ink-3">
          <th className="w-12 py-2 text-start font-bold">{t("rank")}</th>
          <th className="py-2 text-start font-bold">{t("player_col")}</th>
          <th className="w-14 py-2 text-end font-bold">{t("exact_col")}</th>
          <th className="w-14 py-2 text-end font-bold">{t("points_col")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.user_id} className={cn("border-t border-line", r.is_me && "bg-accent/10")}>
            <td className="py-2.5">
              <span
                className={cn(
                  "num inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs",
                  medal(r.pos),
                )}
              >
                {r.pos}
              </span>
            </td>
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
