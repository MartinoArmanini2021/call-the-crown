import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { PrizeStrip } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Round } from "@/lib/api";

export const Route = createFileRoute("/how-to-play")({ component: HowToPlay });

// The rules, rendered from event_config.rules: change the config and this page follows.
function HowToPlay() {
  const { rules } = useEvent();
  const { t } = useT();
  const rounds: Round[] = ["QF", "SF", "3P", "F"];
  const scores = rules.allowed_set_scores.map(([a, b]) => `${a}-${b}`).join(", ");
  const sf = rules.winner_points.SF;
  const sfSets = rules.sets_points.SF;
  const e = rules.per_set_exact;
  // Every match: winner + sets + two exact sets (a two-set match); the bracket has two QFs, two SFs,
  // a third-place match and a final.
  const perfect = (r: Round) => rules.winner_points[r] + rules.sets_points[r] + 2 * e;
  const max = 2 * perfect("QF") + 2 * perfect("SF") + perfect("3P") + perfect("F");
  // The documented example (rank 10 beats rank 1 in a QF), worked from the configured constants so the
  // text can never disagree with the rules. Explanatory only: real points are always the server's.
  const mult = 1 + 9 / (9 + rules.upset_constant);
  const upsetExample = {
    base: rules.winner_points.QF,
    mult: mult.toFixed(2),
    raw: (rules.winner_points.QF * mult).toFixed(1),
    points: Math.round(rules.winner_points.QF * mult),
  };

  const h2 = "headline mb-3 mt-8 text-2xl";
  return (
    <AppShell>
      <PageTitle title={t("htp_title")} />

      <h2 className={h2}>{t("htp_enter")}</h2>
      <ol className="card list-inside list-decimal space-y-2 p-4 text-sm text-ink-2">
        <li>{t("htp_enter_1")}</li>
        <li>{t("htp_enter_2")}</li>
        <li>{t("htp_enter_3", { scores })}</li>
      </ol>
      <p className="mt-3 text-sm text-ink-2">{t("htp_lock")}</p>

      <h2 className={h2}>{t("htp_scoring")}</h2>
      <p className="mb-3 text-sm text-ink-2">{t("htp_scoring_intro")}</p>
      <div className="card overflow-x-auto p-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-3">
              <th className="p-2.5 text-start font-bold" />
              {rounds.map((r) => (
                <th key={r} className="p-2.5 text-end font-bold">
                  {t(`round_${r}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              [t("htp_winner_row"), (r: Round) => rules.winner_points[r]],
              [t("htp_sets_row"), (r: Round) => rules.sets_points[r]],
              [t("htp_exact_row"), () => `+${e}`],
            ].map(([label, value]) => (
              <tr key={label as string} className="border-t border-line">
                <td className="p-2.5 text-ink-2">{label as string}</td>
                {rounds.map((r) => (
                  <td key={r} className="num p-2.5 text-end">
                    {(value as (r: Round) => number | string)(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
        <li>{t("htp_upset", { k: rules.upset_constant })}</li>
        <li className="text-ink-3">{t("htp_upset_example", upsetExample)}</li>
        <li>{t("htp_7_6")}</li>
        <li>{t("htp_two_on_three")}</li>
        <li>{t("htp_void")}</li>
      </ul>

      <h2 className={h2}>{t("htp_example_title")}</h2>
      <div className="card space-y-1.5 p-4 text-sm">
        <p className="text-ink-2">{t("htp_example_pick", { a: "Player A" })}</p>
        <p className="text-ink-2">{t("htp_example_result", { a: "Player A" })}</p>
        <p className="num pt-1 text-base text-accent-text">
          {t("htp_example_sum", { w: sf, s: sfSets, e, total: sf + sfSets + 2 * e })}
        </p>
      </div>
      <p className="mt-3 text-sm text-ink-2">{t("htp_max", { max })}</p>

      <h2 className={h2}>{t("htp_ties")}</h2>
      <ol className="card list-inside list-decimal space-y-2 p-4 text-sm text-ink-2">
        <li>{t("htp_ties_1")}</li>
        <li>{t("htp_ties_2")}</li>
        <li>{t("htp_ties_3")}</li>
        <li>{t("htp_ties_4")}</li>
        <li>{t("htp_ties_5")}</li>
      </ol>

      <div className="mt-8">
        <PrizeStrip />
      </div>
    </AppShell>
  );
}
