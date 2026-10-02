import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { MEDAL, PrizeStrip, SponsorSlot } from "@/components/Brand";
import { QueryGate } from "@/components/QueryGate";
import { useEvent } from "@/config/eventConfig";
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

// Global board and friends leagues (the same table filtered to the members). The first page opens on
// a podium with the prizes (global only: friends leagues have none), and your own row stays pinned
// at the bottom while you scroll.
function Leaderboard() {
  const event = useEvent();
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
  const mine = useQuery({ ...rankWindowQuery(league), enabled: !!user });
  const active = view === "top" ? top : mine;
  const rows = active.data ?? [];
  const total = top.data?.[0]?.total ?? 0;
  const me = mine.data?.find((r) => r.is_me);
  const podium = view === "top" && page === 1 ? rows.slice(0, 3) : [];
  const table = view === "top" && page === 1 ? rows.slice(3) : rows;

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
  const go = (s: Search) => void navigate({ search: { ...(league ? { league } : {}), ...s } });

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
            {podium.length > 0 && <Podium rows={podium} withPrizes={league === null} />}
            {league === null && podium.length > 0 && event.prize_terms_url && (
              <a
                href={event.prize_terms_url}
                target="_blank"
                rel="noopener"
                className="focus-ring mt-2 inline-block text-xs text-ink-3 underline underline-offset-2"
              >
                {t("prize_terms")}
              </a>
            )}
            {league !== null && <p className="mt-2 text-xs text-ink-3">{t("friends_no_prizes")}</p>}
            {table.length > 0 && <BoardTable rows={table} />}
            <p className="mt-2 text-[11px] text-ink-3">{t("exact_key")}</p>
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
    </AppShell>
  );
}

function Podium({ rows, withPrizes }: { rows: BoardRow[]; withPrizes: boolean }) {
  const event = useEvent();
  const { t } = useT();
  const prize = (pos: number) => event.prizes.find((p) => p.place === pos)?.title;
  // 2nd, 1st, 3rd: the winner in the middle, a step higher.
  const order = [rows[1], rows[0], rows[2]];
  return (
    <ol className="grid grid-cols-3 items-end gap-2" aria-label={t("landing_prizes")}>
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
            {withPrizes && prize(r.pos) && (
              <span className="text-[10px] leading-tight text-ink-3">{prize(r.pos)}</span>
            )}
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
