// Leagues first (brief "bragging rights", Phase 2): the small pieces of state that carry a fan from an
// invite or a landing button to their league. All of it lives in the browser only, and every read and
// write is wrapped: with storage blocked the app still works, it just forgets.
//   - a pending invite code, kept in sessionStorage through sign-up and used once;
//   - the active league (shown on Picks), per user, in localStorage;
//   - whether the one-time "Who are you playing against?" step was shown, per user, in localStorage.
import { track } from "./analytics";

const PENDING = "ctc_pending_join";
const active = (uid: string) => `ctc_active_league:${uid}`;
const onboard = (uid: string) => `ctc_onboard_seen:${uid}`;

const read = (store: () => Storage, key: string): string | null => {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
};
const write = (store: () => Storage, key: string, value: string | null) => {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // storage blocked: nothing kept
  }
};
const session = () => sessionStorage;
const local = () => localStorage;

/** An invite code to use once the visitor is signed in (A-Z/0-9, 6 characters). */
export const setPendingJoin = (code: string) => {
  const clean = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (clean.length === 6) write(session, PENDING, clean);
};
export const peekPendingJoin = () => read(session, PENDING);
/** Read and forget: the code is used once. */
export const takePendingJoin = () => {
  const code = read(session, PENDING);
  write(session, PENDING, null);
  return code;
};

export const getActiveLeague = (uid: string) => read(local, active(uid));
export const setActiveLeague = (uid: string, leagueId: string) =>
  write(local, active(uid), leagueId);

export const onboardSeen = (uid: string) => read(local, onboard(uid)) === "1";
export const markOnboardSeen = (uid: string) => write(local, onboard(uid), "1");

/** The league's invite link (the old form; it opens Standings with the code). */
export const inviteLink = (code: string) => `${window.location.origin}/leagues?code=${code}`;

/**
 * Share a league's invite: the phone's share sheet where there is one, otherwise copy the link.
 * Returns "copied" when it copied, null when the fan closed the share sheet.
 */
export async function shareInvite(league: {
  name: string;
  code: string;
}): Promise<"shared" | "copied" | null> {
  const url = inviteLink(league.code);
  try {
    if (navigator.share) {
      await navigator.share({ title: league.name, url });
      track("invite_shared");
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    track("invite_shared");
    return "copied";
  } catch {
    return null; // the fan closed the share sheet, or the clipboard was refused
  }
}
