// Perfect Night (brief "bragging rights", Phase 5): a badge for every night on which the fan called
// every winner (get_my_badges, 0022; the server decides). Shown on the Results header and on Profile;
// nothing at all until there is one.
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/useT";
import { badgesQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PerfectNightBadges({ uid, className }: { uid: string; className?: string }) {
  const { t } = useT();
  const badges = useQuery(badgesQuery(uid));
  const perfect = (badges.data ?? []).filter((b) => b.perfect);
  if (perfect.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {perfect.map((b) => (
        <li
          key={b.night_no}
          className="rounded-2xl border border-gold/50 bg-card px-3 py-2"
          title={t("perfect_night_sub", { n: b.night_no })}
        >
          <span className="block text-sm font-bold text-gold">
            ♛ {t("perfect_night", { n: b.night_no })}
          </span>
          <span className="block text-2xs text-ink-2">
            {t("perfect_night_sub", { n: b.night_no })}
          </span>
        </li>
      ))}
    </ul>
  );
}
