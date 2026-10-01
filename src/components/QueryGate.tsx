import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useT } from "@/i18n/useT";

/**
 * A failed fetch must never render as "no picks" or "zero points". Every screen gates its content on
 * this: real loading, real error, never silence that looks like data.
 * Copied from grand-slam-gm/src/components/QueryStates.tsx.
 */
export function QueryGate({
  queries,
  label,
  children,
}: {
  queries: UseQueryResult<unknown, Error>[];
  label: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const failed = queries.find((q) => q.isError);
  if (failed) {
    return (
      <div className="card mt-4 px-4 py-5">
        <p className="text-sm font-bold text-accent-text">{t("could_not_load", { what: label })}</p>
        <p className="mt-1 text-xs text-ink-3">{t("could_not_load_body")}</p>
        <button
          type="button"
          onClick={() => queries.forEach((q) => q.refetch())}
          className="focus-ring mt-3 h-10 rounded-full bg-accent px-4 text-xs font-bold"
        >
          {t("retry")}
        </button>
      </div>
    );
  }
  if (queries.some((q) => q.isPending)) {
    return (
      <div className="mt-2 space-y-3" aria-busy="true" aria-label={t("loading")}>
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  return <>{children}</>;
}
