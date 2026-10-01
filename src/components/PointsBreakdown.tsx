import { useT } from "@/i18n/useT";
import type { Match, Pick } from "@/lib/api";

/** The stored breakdown of one settled pick. Displayed, never computed here. */
export function PointsBreakdown({ match, pick }: { match: Match; pick: Pick | undefined }) {
  const { t } = useT();
  if (!pick)
    return <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">{t("no_pick")}</p>;
  if (pick.pts_total === null)
    return (
      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">{t("awaiting_result")}</p>
    );
  const rows: [string, number][] = [
    [t("comp_winner"), pick.pts_winner ?? 0],
    [t("comp_sets"), pick.pts_sets ?? 0],
    [`${t("comp_exact")} (${pick.exact_sets ?? 0})`, pick.pts_exact ?? 0],
  ];
  return (
    <div className="mt-3 border-t border-line pt-3">
      {match.status !== "completed" && (
        <p className="mb-2 text-[11px] text-ink-3">
          {t("void_note", {
            status: t(match.status === "retired" ? "retired" : "walkover").toLowerCase(),
          })}
        </p>
      )}
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-ink-2">{label}</dt>
            <dd className="num">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-1.5">
          <dt className="font-bold">{t("total")}</dt>
          <dd className="num text-lg text-accent-text">
            {pick.pts_total} <span className="text-xs text-ink-3">{t("pts")}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
