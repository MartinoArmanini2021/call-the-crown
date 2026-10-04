// Every read and write the app makes. Reads are public tables (event_config, players, matches), the
// fan's own rows (picks, profiles, consents, leagues) or RPCs; every write is an RPC. The app never
// computes points: it shows the stored breakdown and the stored potential winner points.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { SetScore } from "./validation";

export type Round = "QF" | "SF" | "3P" | "F";

export type Rules = {
  winner_points: Record<Round, number>;
  sets_points: Record<Round, number>;
  per_set_exact: number;
  upset_constant: number;
  allowed_set_scores: [number, number][];
  deciding_set: string;
};
export type Prize = { place: number; title: string; title_ar?: string; image_path: string | null };
export type SponsorSlot = {
  slot: "landing_strip" | "leaderboard_header" | "picks_footer" | "results_card";
  image_path: string | null;
  href: string;
  alt: Partial<Record<"en" | "ar", string>>;
};
export type EventConfig = {
  name: string;
  timezone: string;
  rules: Rules;
  league_limits: { max_leagues_per_user: number; max_members: number };
  branding: {
    app_name?: string;
    app_name_ar?: string;
    short_name?: string; // the header mark, e.g. "Call the Crown"
    short_name_ar?: string;
    event_line?: string; // the landing page's line about the event: venue, dates, broadcaster
    event_line_ar?: string;
    logo_path?: string | null;
    colors?: Partial<Record<string, string>>;
  };
  prizes: Prize[];
  prize_terms_url: string | null;
  // Each text may have an Arabic twin (notice_ar …); one version covers both languages.
  privacy: {
    version?: string;
    notice?: string;
    notice_ar?: string;
    consent_gsgm?: string;
    consent_gsgm_ar?: string;
  };
  sponsor_slots: SponsorSlot[];
  flags: { arabic?: boolean };
  tiebreak_seed: string;
};
export type Player = {
  id: string;
  name: string;
  name_ar: string | null;
  country: string | null;
  seed: number | null;
  rank_snapshot: number;
  image_path: string | null;
};
export type SlotSource =
  { type: "player"; id: string } | { type: "winner" | "loser"; match: number };
export type Match = {
  match_no: number;
  round: Round;
  p1_source: SlotSource;
  p2_source: SlotSource;
  p1_id: string | null;
  p2_id: string | null;
  starts_at: string | null;
  p1_win_points: number | null;
  p2_win_points: number | null;
  status: "scheduled" | "completed" | "retired" | "walkover";
  winner_id: string | null;
  set_scores: SetScore[] | null;
  /** the real start, set at settlement from the provider's readings (0018); null until then */
  started_at: string | null;
};
export type Pick = {
  match_no: number;
  winner_id: string;
  sets: 2 | 3;
  set_scores: SetScore[];
  updated_at: string;
  pts_winner: number | null;
  pts_sets: number | null;
  pts_exact: number | null;
  exact_sets: number | null;
  pts_total: number | null;
  exact_flags: (boolean | null)[] | null; // set N called exactly (written by settlement)
};
export type BoardRow = {
  pos: number;
  global_rank: number | null;
  user_id: string;
  display_name: string | null;
  points: number;
  exact_sets: number;
  is_me: boolean;
  total?: number;
};
export type League = {
  id: string;
  name: string;
  code: string;
  is_owner: boolean;
  member_count: number;
};
export type Profile = { user_id: string; display_name: string | null; locale: "en" | "ar" };
export type Consent = {
  party: "organiser" | "gsgm";
  granted: boolean;
  text_version: string;
  changed_at: string;
};

// An RPC error carries a short code (e.g. "locked"); the screens translate it.
export class ApiError extends Error {}
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.message);
  return data as T;
}
async function rows<T>(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiError(error.message);
  return data as T;
}

// Public event data
export const eventConfigQuery = queryOptions({
  queryKey: ["event_config"],
  queryFn: () =>
    rows<EventConfig[]>(supabase.from("event_config").select("*")).then((r) => r[0] ?? null),
  staleTime: 5 * 60_000,
});
export const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => rows<Player[]>(supabase.from("players").select("*").order("seed")),
  staleTime: 5 * 60_000,
});
export const matchesQuery = queryOptions({
  queryKey: ["matches"],
  queryFn: () => rows<Match[]>(supabase.from("matches").select("*").order("match_no")),
  refetchInterval: 30_000,
});
// The server's clock. Locks are decided by the server; the countdowns use its time, not the phone's.
export const serverNowQuery = queryOptions({
  queryKey: ["server_now"],
  queryFn: async () => {
    const before = Date.now();
    const iso = await rpc<string>("app_now");
    const after = Date.now();
    return { offsetMs: Date.parse(iso) - (before + after) / 2 };
  },
  staleTime: 60_000,
  refetchInterval: 60_000,
});

// The fan's own data
export const myPicksQuery = (uid: string) =>
  queryOptions({
    queryKey: ["picks", uid],
    queryFn: () => rows<Pick[]>(supabase.from("picks").select("*").eq("user_id", uid)),
    refetchInterval: 60_000,
  });
export const profileQuery = (uid: string) =>
  queryOptions({
    queryKey: ["profile", uid],
    queryFn: () =>
      rows<Profile[]>(
        supabase.from("profiles").select("user_id, display_name, locale").eq("user_id", uid),
      ).then((r) => r[0] ?? null),
  });
export const consentsQuery = (uid: string) =>
  queryOptions({
    queryKey: ["consents", uid],
    queryFn: () =>
      rows<Consent[]>(
        supabase
          .from("consents")
          .select("party, granted, text_version, changed_at")
          .eq("user_id", uid)
          .order("changed_at"),
      ),
  });
export const myLeaguesQuery = (uid: string) =>
  queryOptions({ queryKey: ["leagues", uid], queryFn: () => rpc<League[]>("my_leagues") });

// Boards
export const leaderboardQuery = (league: string | null, offset: number, limit = 50) =>
  queryOptions({
    queryKey: ["board", league, offset, limit],
    queryFn: () =>
      rpc<BoardRow[]>("get_leaderboard", { p_league: league, p_offset: offset, p_limit: limit }),
    refetchInterval: 60_000,
  });
/** Every member of a league, for its owner (a league holds up to 200, a board page 100: audit F-13). */
export const leagueMembersQuery = (league: string, count: number) =>
  queryOptions({
    queryKey: ["board", league, "all", count],
    queryFn: async () =>
      (
        await Promise.all(
          Array.from({ length: Math.max(1, Math.ceil(count / 100)) }, (_, i) =>
            rpc<BoardRow[]>("get_leaderboard", {
              p_league: league,
              p_offset: i * 100,
              p_limit: 100,
            }),
          ),
        )
      ).flat(),
  });
export const rankWindowQuery = (league: string | null) =>
  queryOptions({
    queryKey: ["rank_window", league],
    queryFn: () => rpc<BoardRow[]>("get_rank_window", { p_league: league, p_radius: 5 }),
    refetchInterval: 60_000,
  });

/** How fans picked a match, as totals; none until it starts (0012). Final at the first ball. */
export type Crowd = {
  picks: number;
  p1_picks: number;
  p2_picks: number;
  top_score: SetScore[] | null;
  top_count: number;
};
export const crowdQuery = (match: number) =>
  queryOptions({
    queryKey: ["crowd", match],
    queryFn: () => rpc<Crowd[]>("get_match_crowd", { p_match: match }).then((r) => r[0] ?? null),
    // fixed once there; until then (a clock a few seconds ahead of the server) ask again
    staleTime: (q) => (q.state.data ? Infinity : 0),
    refetchInterval: (q) => (q.state.data ? false : 60_000),
  });

// Writes
export const savePick = (match: number, winner: string, sets: number, setScores: SetScore[]) =>
  rpc<{ changed: boolean }>("save_pick", {
    p_match: match,
    p_winner: winner,
    p_sets: sets,
    p_set_scores: setScores,
  });
export const createLeague = (name: string) =>
  rpc<{ id: string; code: string; name: string }>("create_league", { p_name: name });
export const joinLeague = (code: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string; name?: string }>("join_league", {
    p_code: code,
  });
export const leaveLeague = (league: string) => rpc<void>("leave_league", { p_league: league });
export const removeMember = (league: string, user: string) =>
  rpc<void>("remove_member", { p_league: league, p_user: user });
export const deleteLeague = (league: string) => rpc<void>("delete_league", { p_league: league });
export const updateProfile = (name: string, locale?: "en" | "ar") =>
  rpc<void>("update_profile", { p_display_name: name, p_locale: locale ?? null });
export const updateConsents = (organiser: boolean, gsgm: boolean, version: string) =>
  rpc<void>("update_consents", { p_organiser: organiser, p_gsgm: gsgm, p_text_version: version });
export const deleteAccount = () => rpc<void>("delete_account");

/**
 * A text from event_config in the fan's language: the Arabic twin (`key_ar`) when the page is in
 * Arabic and the organiser supplied one, otherwise the English text.
 */
export function inLocale<T extends object>(o: T, key: keyof T & string, locale: string) {
  const r = o as Record<string, unknown>;
  const ar = r[`${key}_ar`];
  return (locale === "ar" && typeof ar === "string" && ar ? ar : r[key]) as string | undefined;
}

// Images (organiser-supplied, in the instance's own storage bucket; never hotlinked).
/** An image from the event bucket, or a full https address as it is (the ATP headshots, 4 Oct 2026). */
export const publicImage = (path: string | null | undefined): string | null =>
  !path
    ? null
    : path.startsWith("https://")
      ? path
      : supabase.storage.from("event").getPublicUrl(path).data.publicUrl;
