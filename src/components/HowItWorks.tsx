// How it works, shown rather than told (Tino, 13 Nov 2026: "make the How to play page much more
// visual … an example of how it works"). A real match from the draw walked through in four steps
// (pick the winner, pick the score, the match is played, your points), the upset bonus as two bars,
// the road from the groups to the final in the groups' colours, and playing with friends.
// Every number comes from event_config.rules or the server's stored points (p1/p2_win_points); the
// example's own sum is explanatory, as the worked example always was. The client scores nothing.
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Match, Player, Round } from "@/lib/api";
import { surname } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PlayerPhoto, playerName } from "./Brand";
import { groupsInOrder, useGroupColor } from "./groupColors";

type Props = { matches: Match[]; byPlayer: Map<string, Player> };

export function HowItWorks({ matches, byPlayer }: Props) {
  const { rules } = useEvent();
  const { t, locale } = useT();
  const groupColor = useGroupColor(matches);
  const name = (p: Player | undefined) => (p ? surname(playerName(p, locale)) : "");

  // the example: the first match of the opening round with both players known
  const rounds = (["RR", "QF", "SF", "3P", "F"] as Round[]).filter(
    (r) => rules.winner_points[r] != null,
  );
  const opening = rounds[0] ?? "SF";
  const m = [...matches]
    .filter((x) => x.round === opening && x.p1_id && x.p2_id)
    .sort((a, b) => a.match_no - b.match_no)[0];
  if (!m) return null;
  const p1 = byPlayer.get(m.p1_id!);
  const p2 = byPlayer.get(m.p2_id!);
  const base = rules.winner_points[m.round];
  const pts1 = m.p1_win_points ?? base;
  const pts2 = m.p2_win_points ?? base;
  // the fan backs the favourite (the smaller stored win points) to win in two sets
  const favIs1 = pts1 <= pts2;
  const fav = favIs1 ? p1 : p2;
  const dog = favIs1 ? p2 : p1;
  const favPts = favIs1 ? pts1 : pts2;
  const dogPts = favIs1 ? pts2 : pts1;
  const pick = ["6-4", "6-3"];
  const result = ["6-4", "7-5"];
  const sets = rules.sets_points[m.round];
  const exact = rules.per_set_exact;
  const total = favPts + sets + exact;
  const most = favPts + sets + 2 * exact; // a two-set pick exactly right

  const step = "card p-4";
  const num = (n: number) => (
    <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm text-ink">
      {n}
    </span>
  );
  const head = (n: number, title: string, note: string) => (
    <div className="mb-3 flex items-start gap-3">
      {num(n)}
      <div>
        <h3 className="headline text-xl leading-tight">{title}</h3>
        <p className="text-xs text-ink-3">{note}</p>
      </div>
    </div>
  );
  const groupLabel = m.round === "RR" && m.grp ? t("group_name", { group: m.grp }) : "";

  return (
    <div className="space-y-3">
      <p
        className="text-2xs font-bold uppercase tracking-wider"
        style={{ color: groupColor(m.grp) }}
      >
        {t("htp_example_on")} · {groupLabel || t(`round_${m.round}`)}
      </p>

      {/* 1 · the winner: both players, what a win is worth, the pick highlighted */}
      <section className={step}>
        {head(1, t("htp_step1"), t("htp_step1_note"))}
        <div className="grid grid-cols-2 gap-2">
          {[
            { p: fav, pts: favPts, chosen: true },
            { p: dog, pts: dogPts, chosen: false },
          ].map(({ p, pts, chosen }) => (
            <div
              key={p?.id}
              className={cn(
                "relative flex flex-col items-center rounded-2xl bg-raised p-3 text-center",
                chosen ? "ring-2 ring-accent" : "opacity-80",
              )}
            >
              {chosen && (
                <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold">
                  ✓
                </span>
              )}
              <PlayerPhoto player={p} size={64} className="mb-2" />
              <span className="headline text-lg leading-none">{name(p)}</span>
              <span className="text-2xs text-ink-3">
                {t("world_rank", { rank: p?.rank_snapshot ?? "–" })}
              </span>
              <span className="num mt-1.5 text-base">
                {pts} <span className="text-xs text-ink-3">pt</span>
              </span>
              {pts > base && (
                <span className="mt-1 rounded bg-gold/15 px-1.5 py-0.5 text-2xs font-bold uppercase text-gold">
                  {t("upset_bonus")}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 2 · the score: set by set */}
      <section className={step}>
        {head(2, t("htp_step2"), t("htp_step2_note"))}
        <div className="flex items-center gap-2">
          <PlayerPhoto player={fav} size={36} />
          <span className="headline text-lg">{name(fav)}</span>
          <span className="ms-auto flex gap-1.5">
            {pick.map((s, i) => (
              <span
                key={i}
                className="num rounded-lg bg-accent px-2.5 py-1.5 text-base leading-none text-ink"
              >
                {s}
              </span>
            ))}
          </span>
        </div>
      </section>

      {/* 3 · the match: your pick against the result, set by set */}
      <section className={step}>
        {head(3, t("htp_step3"), t("htp_step3_note"))}
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-3">
            {t("your_pick")}
          </span>
          <span />
          {pick.map((s, i) => (
            <span
              key={i}
              className={cn(
                "num rounded-lg px-2 py-1 text-center",
                s === result[i] ? "bg-good/15 text-good" : "bg-raised text-ink-3",
              )}
            >
              {s}
            </span>
          ))}
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-3">
            {t("row_result")}
          </span>
          <span className="truncate font-semibold">
            {name(fav)} <span className="text-gold">♛</span>
          </span>
          {result.map((s, i) => (
            <span key={i} className="num rounded-lg bg-raised px-2 py-1 text-center text-ink">
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* 4 · the points: one bar, three colours */}
      <section className={step}>
        {head(4, t("htp_step4"), t("htp_step4_note", { most }))}
        <div className="flex h-4 overflow-hidden rounded-full bg-raised" aria-hidden>
          <span className="bg-accent" style={{ width: `${(favPts / most) * 100}%` }} />
          <span className="bg-gold" style={{ width: `${(sets / most) * 100}%` }} />
          <span className="bg-good" style={{ width: `${(exact / most) * 100}%` }} />
        </div>
        <ul className="mt-3 grid gap-1.5 text-sm">
          {[
            { c: "bg-accent", label: t("htp_winner_row"), v: favPts },
            { c: "bg-gold", label: t("htp_sets_row"), v: sets },
            { c: "bg-good", label: t("htp_step4_exact"), v: exact },
          ].map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 text-ink-2">
              <span className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", r.c)} />
                {r.label}
              </span>
              <b className="num text-ink">+{r.v}</b>
            </li>
          ))}
          <li className="mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold">
            <span>{t("htp_example_total")}</span>
            <b className="num text-xl text-accent-text">{total}</b>
          </li>
        </ul>
      </section>

      {/* the upset bonus: the same win, two prices */}
      {dogPts > favPts && (
        <section className={step}>
          <h3 className="headline mb-1 text-xl">{t("htp_upset_title")}</h3>
          <p className="mb-3 text-xs text-ink-3">{t("htp_upset_short")}</p>
          {[
            { p: fav, v: favPts, c: "bg-accent" },
            { p: dog, v: dogPts, c: "bg-gold" },
          ].map(({ p, v, c }) => (
            <div key={p?.id} className="mb-2 flex items-center gap-2 text-sm">
              <PlayerPhoto player={p} size={28} />
              <span className="w-24 shrink-0 truncate">{t("htp_wins", { name: name(p) })}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-raised">
                <span
                  className={cn("block h-full rounded-full", c)}
                  style={{ width: `${(v / Math.max(dogPts, 1)) * 100}%` }}
                />
              </span>
              <b className="num w-12 shrink-0 text-end">{v} pt</b>
            </div>
          ))}
        </section>
      )}

      <Road matches={matches} byPlayer={byPlayer} />
      <Friends />
    </div>
  );
}

/** From the groups to the title: each group's players in its colour, then the points per round. */
function Road({ matches, byPlayer }: Props) {
  const { rules } = useEvent();
  const { t } = useT();
  const groupColor = useGroupColor(matches);
  const groups = groupsInOrder(matches);
  const playersOf = (g: string) =>
    [
      ...new Set(
        matches
          .filter((m) => m.round === "RR" && m.grp === g)
          .flatMap((m) => [m.p1_id, m.p2_id])
          .filter((x): x is string => !!x),
      ),
    ]
      .map((id) => byPlayer.get(id))
      .filter((p): p is Player => !!p)
      .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
  const stages = (["SF", "F"] as Round[]).filter((r) => rules.winner_points[r] != null);
  if (groups.length === 0) return null;
  return (
    <section className="card p-4">
      <h3 className="headline mb-1 text-xl">{t("htp_road_title")}</h3>
      <p className="mb-3 text-xs text-ink-3">{t("htp_road_note")}</p>
      <div className="grid grid-cols-2 gap-2">
        {groups.map((g) => (
          <div
            key={g}
            className="rounded-xl border-t-[3px] bg-raised p-2.5"
            style={{ borderTopColor: groupColor(g) }}
          >
            <p
              className="mb-2 text-2xs font-bold uppercase tracking-wider"
              style={{ color: groupColor(g) }}
            >
              {t("group_name", { group: g })}
            </p>
            <div className="flex -space-x-2">
              {playersOf(g).map((p) => (
                <PlayerPhoto key={p.id} player={p} size={32} className="ring-2 ring-raised" />
              ))}
            </div>
            <p className="num mt-2 text-xs text-ink-2">
              {t("htp_road_pts", { n: rules.winner_points.RR })}
            </p>
          </div>
        ))}
      </div>
      <div className="my-2 text-center text-ink-3" aria-hidden>
        ↓
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stages.map((r) => (
          <div
            key={r}
            className={cn(
              "rounded-xl bg-raised p-2.5 text-center",
              r === "F" && "ring-1 ring-inset ring-gold/60",
            )}
          >
            <p className={cn("headline text-lg", r === "F" && "text-gold")}>
              {r === "F" && "♛ "}
              {t(`round_${r}`)}
            </p>
            <p className="num text-xs text-ink-2">
              {t("htp_road_pts", { n: rules.winner_points[r] })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Playing with friends: a league, a code to share, everyone's picks once a match starts. */
function Friends() {
  const { t } = useT();
  const rows = [
    { n: t("htp_friend_a"), pick: "6-4 6-3", pts: 14, me: false },
    { n: t("crowd_you"), pick: "6-4 7-5", pts: 18, me: true },
    { n: t("htp_friend_b"), pick: "3-6 4-6", pts: 0, me: false },
  ].sort((a, b) => b.pts - a.pts);
  return (
    <section className="card p-4">
      <h3 className="headline mb-1 text-xl">{t("htp_friends_title")}</h3>
      <p className="mb-3 text-xs text-ink-3">{t("htp_friends_note")}</p>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={r.n}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
              r.me ? "bg-accent/20" : "bg-raised",
            )}
          >
            <span className="num w-4 text-ink-3">{i + 1}</span>
            <span className={cn("flex-1 truncate", r.me && "font-bold")}>{r.n}</span>
            <span className="num text-xs text-ink-2">{r.pick}</span>
            <b className={cn("num w-8 text-end", r.pts > 0 ? "text-good" : "text-ink-3")}>
              +{r.pts}
            </b>
          </li>
        ))}
      </ol>
    </section>
  );
}
