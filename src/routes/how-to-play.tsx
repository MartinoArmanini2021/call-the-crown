import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { PrizeStrip } from "@/components/Brand";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import type { Round } from "@/lib/api";

export const Route = createFileRoute("/how-to-play")({ component: HowToPlay });

// The rules, rendered from event_config.rules: change the config and this page follows. Plain words
// first (how to pick, what it earns, one worked example); the upset formula sits behind "The exact
// maths" (Tino, 2 Oct 2026: "it needs to be easy to understand").
function HowToPlay() {
  const { rules, tiebreak_seed } = useEvent();
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
  // The upset example (world no. 10 beats no. 1 in a quarter-final), worked from the configured
  // constants so the text can never disagree with the rules. Explanatory only: real points are always
  // the server's (halves round up, as in the scoring SQL).
  const gap = 9;
  const upsetExample = {
    low: 1 + gap,
    high: 1,
    base: rules.winner_points.QF,
    points: Math.floor(rules.winner_points.QF * (1 + gap / (gap + rules.upset_constant)) + 0.5),
  };

  const h2 = "headline mb-3 mt-8 text-2xl";
  const line = (ok: boolean, label: string, pts: number) => (
    <li className="flex justify-between gap-3 text-ink-2">
      <span>
        <span className={ok ? "text-good" : "text-ink-3"}>{ok ? "✓" : "✗"}</span> {label}
      </span>
      <b className={ok ? "num text-ink" : "num text-ink-3"}>+{pts}</b>
    </li>
  );

  return (
    <AppShell>
      <PageTitle title={t("htp_title")} sub={t("landing_sentence", { n: 6 })} />

      <h2 className={h2}>{t("htp_enter")}</h2>
      <ol className="card space-y-3 p-4 text-sm text-ink-2">
        {[t("htp_enter_1"), t("htp_enter_2", { scores }), t("htp_enter_3")].map((text, i) => (
          <li key={i} className="grid grid-cols-[26px_1fr] items-start gap-2.5">
            <span className="num grid h-[26px] w-[26px] place-items-center rounded-full bg-accent text-xs text-ink">
              {i + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
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

      <h2 className={h2}>{t("htp_example_title")}</h2>
      <section className="card p-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <p className="num rounded-xl bg-raised px-3 py-2">
            {t("htp_example_pick", { a: "Player A" })}
          </p>
          <p className="num rounded-xl bg-raised px-3 py-2">
            {t("htp_example_result", { a: "Player A" })}
          </p>
        </div>
        <ul className="mt-3 grid gap-1.5">
          {line(true, t("htp_example_winner"), sf)}
          {line(true, t("htp_example_sets"), sfSets)}
          {line(true, t("htp_example_exact"), 2 * e)}
          {line(false, t("htp_example_miss"), 0)}
          <li className="mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold">
            <span>{t("htp_example_total")}</span>
            <b className="num text-accent-text">{sf + sfSets + 2 * e}</b>
          </li>
        </ul>
      </section>

      <h2 className={h2}>{t("htp_upset_title")}</h2>
      <div className="card space-y-2 p-4 text-sm text-ink-2">
        <p>{t("htp_upset")}</p>
        <p className="text-ink">{t("htp_upset_example", upsetExample)}</p>
        <details className="text-xs text-ink-3">
          <summary className="focus-ring cursor-pointer rounded font-semibold">
            {t("htp_upset_maths_title")}
          </summary>
          <p className="mt-1.5">{t("htp_upset_maths", { k: rules.upset_constant })}</p>
        </details>
      </div>

      <h2 className={h2}>{t("htp_small_print")}</h2>
      <ul className="card list-inside list-disc space-y-2 p-4 text-sm text-ink-2">
        <li>{t("htp_7_6")}</li>
        <li>{t("htp_two_on_three")}</li>
        <li>{t("htp_void")}</li>
        <li>{t("htp_max", { max })}</li>
      </ul>

      <h2 className={h2}>{t("htp_ties")}</h2>
      <ol className="card list-inside list-decimal space-y-2 p-4 text-sm text-ink-2">
        <li>{t("htp_ties_1")}</li>
        <li>{t("htp_ties_2")}</li>
        <li>{t("htp_ties_3")}</li>
        <li>
          {t("htp_ties_4")}{" "}
          <code className="break-all font-mono text-xs text-ink-3">{tiebreak_seed}</code>
        </li>
      </ol>

      <div className="mt-8">
        <PrizeStrip />
      </div>
    </AppShell>
  );
}
