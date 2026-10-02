import type { Match, Player } from "./api";
import type { SetScore } from "./validation";

/** "2d 5h", "3h 20m", "12m", "45s". Adapted from grand-slam-gm/src/lib/timeLeft.ts. */
export function shortTimeLeft(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Set scores always in the match's fixed order: player 1's games first. "6-4 3-6 7-6". */
export const scoreLine = (sets: SetScore[] | null | undefined) =>
  (sets ?? []).map((s) => `${s.p1_games}-${s.p2_games}`).join("  ");

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
