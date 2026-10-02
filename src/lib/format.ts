import type { Match, Player } from "./api";
import type { SetScore } from "./validation";

// Time units for the countdowns. Arabic: ي يوم, س ساعة, د دقيقة, ث ثانية (draft, organiser review).
const UNITS = { en: ["d", "h", "m", "s"], ar: ["ي", "س", "د", "ث"] } as const;

/** "2d 5h", "3h 20m", "12m 05s", "45s" (Arabic "2ي 5س"). Adapted from grand-slam-gm/src/lib/timeLeft.ts. */
export function shortTimeLeft(ms: number, locale: string = "en"): string {
  const [d, h, m, sec] = UNITS[locale === "ar" ? "ar" : "en"];
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}${sec}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${m} ${String(seconds % 60).padStart(2, "0")}${sec}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${h} ${minutes % 60}${m}`;
  return `${Math.floor(hours / 24)}${d} ${hours % 24}${h}`;
}

/** Set scores always in the match's fixed order: player 1's games first. "6-4 3-6 7-6". */
export const scoreLine = (sets: SetScore[] | null | undefined) =>
  (sets ?? []).map((s) => `${s.p1_games}-${s.p2_games}`).join("  ");

/** The event's local day, e.g. "Wed 21 Oct". */
export function localDay(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

/** The event's local time, e.g. "Wed 21 Oct, 19:30". */
export function localTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const playerById = (players: Player[]) => new Map(players.map((p) => [p.id, p]));

/** The name a scoreboard uses: everything after the given name ("Alex de Minaur" → "de Minaur"). */
export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name.trim();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}

export type MatchState = "waiting" | "open" | "locked" | "settled";
export function matchState(m: Match, nowMs: number): MatchState {
  if (m.status !== "scheduled") return "settled";
  if (!m.p1_id || !m.p2_id || !m.starts_at) return "waiting";
  return Date.parse(m.starts_at) <= nowMs ? "locked" : "open";
}
