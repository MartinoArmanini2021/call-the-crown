import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import { publicImage, type Player, type SponsorSlot as Slot } from "@/lib/api";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A player's organiser-supplied image, or their initials. Never a third-party hotlink. */
export function PlayerBadge({ player, size = 40 }: { player: Player | undefined; size?: number }) {
  const { locale } = useT();
  const src = publicImage(player?.image_path);
  const name = player ? (locale === "ar" && player.name_ar ? player.name_ar : player.name) : "?";
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-raised object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="headline flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {player ? initials(name) : "?"}
    </span>
  );
}

export function playerName(player: Player | undefined, locale: string): string {
  if (!player) return "TBD";
  return locale === "ar" && player.name_ar ? player.name_ar : player.name;
}

/**
 * The fixed sponsor placements (plan: landing strip, leaderboard header, picks footer, results card).
 * Image + link + alt text from event_config.sponsor_slots; an empty slot renders nothing.
 */
export function SponsorSlot({ slot, className }: { slot: Slot["slot"]; className?: string }) {
  const event = useEvent();
  const { locale } = useT();
  const s = event.sponsor_slots.find((x) => x.slot === slot);
  if (!s) return null;
  const src = publicImage(s.image_path);
  const alt = s.alt[locale] ?? s.alt.en ?? "";
  return (
    <a
      href={s.href}
      target="_blank"
      rel="noopener sponsored"
      className={cn("focus-ring card block overflow-hidden", className)}
      data-sponsor-slot={slot}
    >
      {src ? (
        <img src={src} alt={alt} className="h-16 w-full object-contain" />
      ) : (
        <span className="flex h-16 items-center justify-center text-xs uppercase tracking-widest text-ink-3">
          {alt}
        </span>
      )}
    </a>
  );
}

/** The top-3 prizes, from event_config, with the link to the organiser's prize terms. */
export const MEDAL = ["bg-gold", "bg-silver", "bg-bronze"] as const;

export function PrizeStrip({ compact = false }: { compact?: boolean }) {
  const event = useEvent();
  const { t } = useT();
  if (event.prizes.length === 0) return null;
  // Always one prize per line: three boxes side by side clip the text at phone width.
  return (
    <section className={cn("card", compact ? "p-3" : "p-4")}>
      <h2 className={cn("headline", compact ? "text-base" : "text-xl")}>{t("landing_prizes")}</h2>
      <ol className={cn("grid", compact ? "mt-2 gap-1.5" : "mt-3 gap-2")}>
        {[...event.prizes]
          .sort((a, b) => a.place - b.place)
          .map((p) => {
            const img = publicImage(p.image_path);
            return (
              <li key={p.place} className="flex items-center gap-3">
                <span
                  className={cn(
                    "num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-bg",
                    MEDAL[p.place - 1] ?? "bg-raised",
                  )}
                >
                  {p.place}
                </span>
                {img && <img src={img} alt="" className="h-9 w-9 rounded object-cover" />}
                <span className="min-w-0 text-sm leading-snug text-ink-2">{p.title}</span>
              </li>
            );
          })}
      </ol>
      {event.prize_terms_url && (
        <a
          href={event.prize_terms_url}
          target="_blank"
          rel="noopener"
          className="focus-ring mt-3 inline-block text-xs text-ink-3 underline underline-offset-2"
        >
          {t("prize_terms")}
        </a>
      )}
    </section>
  );
}
