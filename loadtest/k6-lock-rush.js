// k6 load test — "the 10 minutes before a lock". WRITTEN, NOT RUN (Phase 1). Runs on STAGING only,
// after Tino's sign-off for Phase 3. It refuses to start without LOADTEST_TARGET=staging.
//
// What it does
//   setup:  creates USERS invented test fans through the Auth admin API (service key, staging only),
//           each confirmed, flagged is_test (excluded from billing), with a throwaway password used
//           only by this script. Password sign-in exists on staging for this purpose alone; the app
//           itself only ever uses email codes.
//   rush:   ramps virtual fans up to PEAK_VUS over RAMP, holds for HOLD. Each fan signs in once, then
//           loops like a real fan before a lock: read the bracket, save a pick (a random legal pick,
//           sometimes the same one again, sometimes a change), glance at "my rank".
//   teardown: deletes the test fans it created.
//
// Run:
//   k6 run -e LOADTEST_TARGET=staging -e SUPABASE_URL=https://<staging>.supabase.co \
//          -e ANON_KEY=... -e SERVICE_KEY=... -e USERS=5000 -e PEAK_VUS=2000 loadtest/k6-lock-rush.js
// Settlement at 100,000 picks is measured separately: loadtest/settle-100k.sql.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import exec from "k6/execution";

const URL = __ENV.SUPABASE_URL;
const ANON = __ENV.ANON_KEY;
const SERVICE = __ENV.SERVICE_KEY;
const USERS = Number(__ENV.USERS || 5000);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 2000);
const RAMP = __ENV.RAMP || "3m";
const HOLD = __ENV.HOLD || "7m";
const MATCH = Number(__ENV.MATCH || 1);
const PASSWORD = `lt-${Math.random().toString(36).slice(2)}-${Date.now()}`;

if (__ENV.LOADTEST_TARGET !== "staging") throw new Error("Set LOADTEST_TARGET=staging. This script never runs against production.");

const savePickMs = new Trend("save_pick_ms", true);
const savePickErrors = new Rate("save_pick_errors");

export const options = {
  setupTimeout: "30m",
  teardownTimeout: "30m",
  scenarios: {
    lock_rush: {
      executor: "ramping-vus",
      stages: [
        { duration: RAMP, target: PEAK_VUS },
        { duration: HOLD, target: PEAK_VUS },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    save_pick_ms: ["p(95)<500", "p(99)<1500"],
    save_pick_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
  },
};

const json = (token, extra = {}) => ({
  headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra },
});
const admin = { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" } };

export function setup() {
  const ids = [];
  for (let i = 0; i < USERS; i++) {
    const email = `k6-${i}-${Date.now()}@example.test`;
    const r = http.post(`${URL}/auth/v1/admin/users`, JSON.stringify({
      email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: `Load ${i}` },
    }), admin);
    if (r.status === 200 || r.status === 201) ids.push({ id: r.json("id"), email });
  }
  // Flag them as test accounts so billing_report never counts them.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).map((u) => u.id).join(",");
    http.patch(`${URL}/rest/v1/profiles?user_id=in.(${chunk})`, JSON.stringify({ is_test: true }), admin);
  }
  const match = http.get(`${URL}/rest/v1/matches?match_no=eq.${MATCH}&select=*`, json(ANON)).json()[0];
  const rules = http.get(`${URL}/rest/v1/event_config?select=rules`, json(ANON)).json()[0].rules;
  if (!match || !match.p1_id || !match.p2_id) throw new Error(`match ${MATCH} has no players on staging`);
  return { users: ids, match, allowed: rules.allowed_set_scores };
}

let token = null;
function signIn(data) {
  const u = data.users[(exec.vu.idInTest - 1) % data.users.length];
  const r = http.post(`${URL}/auth/v1/token?grant_type=password`, JSON.stringify({ email: u.email, password: PASSWORD }), json(ANON));
  token = r.status === 200 ? r.json("access_token") : null;
}

function randomPick(data) {
  const m = data.match;
  const w = Math.random() < 0.5 ? 1 : 2;
  const sets = Math.random() < 0.4 ? 3 : 2;
  const s = () => data.allowed[Math.floor(Math.random() * data.allowed.length)];
  const as = (winnerSlot, [hi, lo]) => (winnerSlot === 1 ? { p1_games: hi, p2_games: lo } : { p1_games: lo, p2_games: hi });
  const scores = sets === 2 ? [as(w, s()), as(w, s())] : [as(w, s()), as(3 - w, s()), as(w, s())];
  return { p_match: m.match_no, p_winner: w === 1 ? m.p1_id : m.p2_id, p_sets: sets, p_set_scores: scores };
}

export default function (data) {
  if (!token) signIn(data);
  if (!token) return;

  http.get(`${URL}/rest/v1/matches?select=*&order=match_no.asc`, json(token));
  sleep(1 + Math.random() * 3);

  const r = http.post(`${URL}/rest/v1/rpc/save_pick`, JSON.stringify(randomPick(data)), json(token));
  savePickMs.add(r.timings.duration);
  savePickErrors.add(r.status !== 200);
  check(r, { "save_pick 200": (x) => x.status === 200 });
  sleep(2 + Math.random() * 6);

  if (Math.random() < 0.3) http.post(`${URL}/rest/v1/rpc/get_rank_window`, JSON.stringify({ p_radius: 5 }), json(token));
  sleep(5 + Math.random() * 20);
}

export function teardown(data) {
  for (const u of data.users) http.del(`${URL}/auth/v1/admin/users/${u.id}`, null, admin);
}
