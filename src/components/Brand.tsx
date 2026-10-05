import { useState } from "react";
import { useEvent } from "@/config/eventConfig";
import { useT } from "@/i18n/useT";
import { inLocale, publicImage, type Player, type SponsorSlot as Slot } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A player's photo: the official ATP headshot (Tino, 4 Oct 2026; hotlinked, never re-hosted) or an
 * uploaded image. Nothing when there is none or it fails to load: the name always carries the player,
 * never initials.
 */
export function PlayerPhoto({
  player,
  size = 40,
  className,
}: {
  player: Player | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = publicImage(player?.image_path);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-raised object-cover object-top", className)}
      style={{ width: size, height: size }}
    />
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

/** Medal colours for the podium's places 1-3. */
export const MEDAL = ["bg-gold", "bg-silver", "bg-bronze"] as const;
