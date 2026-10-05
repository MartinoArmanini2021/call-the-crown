# Full debug brief: Call the Crown

## Read first: setup notes (added 5 Oct 2026 when this brief was saved)

These correct the brief to the repository as it is. Where the brief and these notes disagree, the notes win.

1. **There is no app code on `main`.** Locally `main` is an empty initial commit, and it is not on GitHub. The app is on **`build/phase-1`** (origin, `e50b2c5`), and `feat/bragging-rights` was branched from it. Everywhere the brief below says `main`, read **`build/phase-1`**. The table and sections A1, A2, C and Part 2 below are already corrected.
2. **Specification for Part 1:** `docs/briefs/bragging-rights/brief.md` (saved from the original paste, unchanged).
3. **The "four mockups"** mentioned in G and in the build brief were never added to the repo. G's mockup comparison cannot be done: report it as skipped unless Tino supplies them.
4. **Local stack.**
   - Docker Desktop must be running. If it is not: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, then `bunx supabase start`.
   - Ports 55320–55329.
     - DB: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`
     - API: `http://127.0.0.1:55321`
     - Mailpit: `http://127.0.0.1:55324`
   - **After every `supabase db reset`, restore the two Vault secrets** or the cron jobs silently do nothing:
     - `select vault.create_secret('http://host.docker.internal:55321/functions/v1', 'functions_url');`
     - `select vault.create_secret('<SERVICE_ROLE_KEY from bunx supabase status -o json>', 'service_role_key');`
   - Edge functions: `bunx supabase functions serve --env-file supabase/functions/.env`.
   - `.env` and `supabase/functions/.env` are git-ignored. In a fresh worktree, copy both from `C:\Users\marti\six-kings-game`. Locally, `PROVIDER=fixture`, and there is no `RESEND_API_KEY`, so reminders run as a dry run.
5. **Time.** In the migrations `app_now()` is `now()`. The local seed (`supabase/dev/sim_clock.sql`, applied by `config.toml` `sql_paths`) replaces it with a simulated clock moved by `public.dev_set_now(ts)`. That file is local-only, and the SQL tests use it too. Rule 5's intent stands: never change `app_now()` in a migration.
6. **One local database for both parts.** Parts 1 and 2 cannot run `db reset` at the same time on the same stack. Run Part 1 first, then Part 2. If you find the other part's session still using the stack, stop and ask.
7. **Gates** (AGENTS.md):
   - `bun test`, `bun run test:sql` (PGlite), `bunx tsc --noEmit`, `bun run build`, `bun run lint`, `bun run advisors`.
   - For `supabase/` changes, also:
     - the real-Postgres `test:sql` (`TEST_DATABASE_URL=… bun run test:sql`);
     - `bunx supabase db advisors --local`;
     - `bun scripts/walkthrough-local.ts`;
     - `bun scripts/simulate-event.ts`.
   - `walkthrough-local` assumes a freshly reset database.
8. **Known items from the build's own report (unproven: verify them, don't trust them):**
   - signed-in users can read every pick of a started match (`picks` policy);
   - `get_leaderboard` still returns a `total` column, though the app no longer shows it (commit `5084c5c`);
   - `canonical_set_scores` keeps set order;
   - `leagues.crew_hidden` is readable by members of that league through the existing table grant.
9. **Rule 1 on git:** commit on the fix branches only. Never push to `main` or `build/phase-1`. Pushing the fix branch is Tino's call.

---

This brief audits **everything** in Call the Crown: the repo `six-kings-game`, its database, its edge functions, its scheduled jobs and its hosting. It has two parts. Run **each part in its own new Claude Code session**, never the session that wrote the code. You are the reviewer: every claim in any earlier report is unproven until you have checked it yourself.

| Part | What it covers | Branch it reads | Branch it fixes on | When |
|---|---|---|---|---|
| **1. The new build** | Sections A to J | `feat/bragging-rights` (base `build/phase-1`) | `feat/bragging-rights` | First |
| **2. The rest of the app** | Sections K to R | `build/phase-1` | `fix/full-audit` (from `build/phase-1`) | After Part 1 (one local database, note 6) |

The build brief, `docs/briefs/bragging-rights/brief.md`, is the specification for Part 1. For Part 2 the specification is: the How to play text in both languages, `event_config`, and the rules written in this brief.

Use subagents for independent sections so that each one gets full attention. Sections C+D, E, G and I in Part 1, and K to R in Part 2, can run in parallel. Subagents share one local database: coordinate `db reset`s, or use the in-process PGlite harness (`scripts/lib/db.ts`) where a real stack is not needed.

## Rules for both parts

1. **Local only.**
   - Use the local Supabase stack (`supabase start`, `supabase functions serve`).
   - Do not write to or deploy to the remote project `rmjlqqzytahmdlmnwxfc`.
   - Do not deploy anything anywhere.
   - The only network calls allowed outside the local stack are those in O5 (read-only).
2. **Pass 1 is read-only for product code.** You may add tests, scripts and fixtures under `tests/verify/`, and nothing else.
3. **Pass 2 fixes only BUG and SECURITY findings.** For each one:
   - first write a test that fails because of the bug;
   - then make the smallest fix;
   - then show the test passing, with the full suite still green.

   One commit per finding, on the part's fix branch.
4. **Stop and ask, do not fix, if** a fix would touch any of the following. For these, deliver the failing test and the proposed fix as a patch file in `tests/verify/proposed/`, and do not apply it:
   - scoring (`save_pick`, `score_match`, `settle_match`, `refresh_match_points`, `win_points`, `validate_*`, `canonical_set_scores`, `orient_set_scores`, `recompute_standings`, `advance_bracket`, tiebreaks, `event_config.rules`);
   - result ingest (`poll-results`, `ingest_result`, `kick_poller`, `watchdog`);
   - any RLS policy, grant or auth setting;
   - `update_consents`, consents data, or the privacy text;
   - deleting anything (tables, functions, columns, code paths).
5. **Time.** `app_now()` returns `now()` (locally: see setup note 5). Simulate time by shifting fixture match times relative to `now()`. If you must override `app_now()`, do it inside test setup only, never in a migration.
6. **Report everything you notice.** In Part 1, mark problems in code the build did not touch "pre-existing" and leave them for Part 2. In Part 2, everything is in scope.
7. **Never conclude "no issues" for a section you did not fully run.** Say what you skipped and why.

Severity labels:
- **BUG/SECURITY**: wrong result, data leak, rule broken, or abuse possible.
- **SMELL**: works, but fragile or misleading.
- **OPTIONAL**: a polish idea.

# PART 1: the new build (`feat/bragging-rights`)

## A. Did the build stay inside its fence?

1. Run `git diff --stat build/phase-1...feat/bragging-rights` and list every changed file. Flag any file outside what the brief's six phases need.
2. **Catalog diff.** `supabase db reset` on `build/phase-1` and dump the schema with `pg_dump --schema-only`, including functions, policies, grants and cron jobs. Repeat on the branch, then diff the two dumps. Every difference must map to a brief requirement. Flag anything else as BUG.
3. From the diff, confirm explicitly:
   - none of the protected functions in Rule 4 changed;
   - `app_now()` is unchanged;
   - no existing policy or grant changed;
   - the only function changed is `get_match_crowd`, and its grants are identical before and after;
   - there is exactly one new cron job (`send-reminders`), and `poll-results` and `watchdog` are byte-identical.
4. Search for `.skip`, `.only`, `xit`, `xdescribe`, and tests with no assertions. Any of these is a SMELL, or a BUG if it hides a failing test.

## B. Do the tests actually test anything?

1. From a clean `supabase db reset`, run the full test suite, typecheck, lint and production build. Record the commands and the pass counts.
2. **Mutation checks.** Make each change below by hand, run the tests, confirm at least one test fails, then revert. A change that leaves every test green is a BUG: the test is missing. Add the test.

| Change | Test that should fail |
|---|---|
| `rarity_min_picks` read as 49 instead of 50 | crowd / my-call threshold |
| Rarity cut-offs 20% → 21%, and 40% → 41% | rarity line shown at the boundary |
| Crew score averaged over the best 4 instead of the best 5 | crew ranking |
| Crew eligibility `>= 5` → `> 5` | the 5-member league included |
| Perfect Night that ignores a missing pick | missing pick is not perfect |
| Reminder sent without the `reminder_sends` claim | concurrent runs send once |
| Unsubscribe accepts GET | GET changes nothing |
| `get_match_crowd` returning counts again | shares only, no counts |

## C. Scoring is untouched: parity

1. Build one fixture event: 6 matches, 60 synthetic users (`is_test = true`), random but seeded picks. Include:
   - 2-set and 3-set picks;
   - an upset winner;
   - one retirement;
   - one walkover.
2. Settle it on `build/phase-1` and on the branch. Export every pick's `pts_winner`, `pts_sets`, `pts_exact`, `exact_sets`, `pts_total`, plus the whole `standings` table. The two exports must be identical row for row. Any difference is a BUG.

## D. Independent oracle

Write `tests/verify/oracle.ts`. It computes expected points, ranks, crew board, Perfect Night badges and rarity shares from:
- the rules as written in How to play;
- `event_config.rules`;
- the build brief.

It **must not import or call any app code or SQL function**. Run it on the fixture from C and compare against the branch's results.

Every mismatch gets one of two verdicts:
- **BUG in code**, or
- **ambiguity in the rules**: quote the rule text, and do not choose which side is right.

## E. Security and privacy, as an attacker

Use `supabase-js` against the local stack as three callers: anon, user A, and user B.

1. Every **new** function, called as anon, is denied.
2. Direct `select`, `insert`, `update` and `delete` on `reminder_sends` and other new tables, as user A, is denied.
3. `get_my_call_stats`:
   - returns nothing before the start;
   - returns nothing for a match where the caller has no pick;
   - returns NULL counts below the threshold;
   - a raw RPC call (bypassing the UI) still never yields counts below 50.
4. `get_match_crowd` below 50 picks: no row, even via a raw RPC call.
5. `set_reminder_optin` called by A can only change A's consent.
6. **`send-reminders` must only run when called with the service role.** Call it with user A's normal login token. If it runs, that's SECURITY: any signed-in user could trigger mass emails.
7. Unsubscribe:
   - a forged token → 403;
   - A's token used with B's id → 403;
   - GET does nothing;
   - the token comparison is constant-time.
8. **Injection.** Create a league and a display name containing `<img src=x onerror=alert(1)>`, a long Arabic string with bidi control characters (U+202E), and 200 characters of text. Check every place they render:
   - the Crews board;
   - the leaderboard;
   - the cards (canvas);
   - the email HTML;
   - the share text.

   Nothing may execute, and nothing may break the layout or flip surrounding text direction.
9. **Secrets.** Search the production build output (`dist/`) for `RESEND`, `service_role`, `REMINDER_UNSUB_SECRET`, `sk_`, and any JWT-shaped string except the public anon key.
10. **Size leaks.** List every place where a count of users, picks, leagues or members reaches the browser, through the UI or any RPC response. Capture the network traffic with Playwright during a full click-through.

    Report each place found, new or pre-existing (for example the leaderboard's `total`). Do not fix pre-existing ones: list them for a decision.

## F. Edge cases

1. **Night grouping across midnight in Riyadh.** Put a night's last match at 21:30 UTC, which is 00:30 the next day in Riyadh. Check that the night does not split into a fourth night in:
   - Perfect Night;
   - reminders;
   - the card's "Night" label;
   - the client's existing `night_1` to `night_3` labels.

   If it does split, report BUG with a proposed fix. Do not apply it: it touches the night definition, so stop and ask.
2. **Reminder edge cases:**
   - the first match moves later after a reminder was sent → still exactly 1 email;
   - the first match's players aren't known yet;
   - a user picks everything between the claim and the send;
   - an opted-in user who deleted their account;
   - the dry-run path when `RESEND_API_KEY` is missing.
3. **Crews:**
   - a member leaves and the league drops to 4 → it leaves the board;
   - members with no standings row count as 0;
   - an exact tie through every tiebreak level;
   - a hidden league stays out even when it would rank #1;
   - the caller's own league at rank 500 is still returned.
4. **Rarity:**
   - exactly 20.0% and 40.0% → line shown;
   - 20.1% → hidden;
   - 0.4% → `under 1%`;
   - rounding is always down;
   - the same score in a different set order counts as exact.
5. **Invite flow:**
   - invalid code;
   - full league;
   - a user removed from that league;
   - already a member;
   - code typed in lowercase or with spaces;
   - a pending code that survives the email-code sign-in;
   - a pending code consumed only once (reload after joining does not re-run it).
6. **Share:**
   - `navigator.share` missing;
   - `canShare` false for files;
   - clipboard permission denied: the download still happens and the text is shown;
   - user cancels the native share sheet: no error toast;
   - fonts not yet loaded: the card waits and never renders in a fallback font.

## G. Cards in three browser engines

Using Playwright, render all card states in Chromium, Firefox and **WebKit** (Safari's engine):
- My Call EN and AR;
- exact EN and AR;
- winner-only with and without a rarity line;
- void;
- Perfect Night ribbon;
- no-league footer;
- the longest real player names (`نوفاك ديوكوفيتش`, `de Minaur`), in both rows of the scoreboard.

Save them to `tests/verify/cards/<engine>/` and check:
- 1080×1350;
- under 1 MB;
- Arabic letters joined, not isolated;
- text right to left, set 1 on the right;
- no text clipped or overlapping (do a pixel check on the margins);
- the numbers `+20`, `21–24` and `19:30` read left-to-right inside Arabic text.

Compare against the four mockups in `docs/briefs/bragging-rights/` (missing: see setup note 3).

## H. Copy and language

1. Every i18n key exists in both EN and AR, with no empty values.
2. Crawl every screen in AR with Playwright and list any Latin-script words outside an allow-list: player names, the domain, league codes, `DELETE`.
3. Every Arabic string in the brief appears in the code **exactly**, character for character. Report each difference.
4. Rerun the audit:
   - English: `prize|wager|odds|stake|gambl|\bbet\b|win more`
   - Arabic: `جائز|جوائز|راهن|رهان|مراهن|اربح`

   Search the source **and** the built bundle **and** `event_config`. The only allowed hit is the "no betting" fine print.
5. Search the bundle and the database for `Six Kings`, `Slam`, and `#e50914` / `e50914` in any new UI.

## I. Load

Seed the local database with 100,000 users, 20,000 leagues of sizes 1 to 200, and 600,000 picks. Run `EXPLAIN ANALYZE` on:
- `get_crew_board`;
- `get_my_call_stats`;
- `get_match_crowd`;
- `get_my_badges`;
- the reminder recipient query.

Target: each under **200 ms** warm. Report each time. Anything over is SMELL, with the missing index named. Do not add indexes in Pass 1.

## J. Part 1 report (reply with this, in this order)

1. **Verdict: GO or NO-GO.**
   - GO requires all four: zero open BUG/SECURITY findings; every section A to I actually run; C parity identical; D oracle with no unexplained mismatches.
   - Otherwise NO-GO, with the reason.
2. **Findings**, ranked BUG/SECURITY → SMELL → OPTIONAL. For each:
   - file and line;
   - what is wrong;
   - how to reproduce it;
   - the failing test's name;
   - status after Pass 2.
3. **Section-by-section results**: commands run, pass counts, timings.
4. **Decisions needed from Tino**: rule ambiguities from D, size leaks from E10, the night split from F1, and anything you stopped on.
5. **Not verifiable here**, to be checked by a person:
   - real iPhone and Android sharing into WhatsApp;
   - real Resend delivery and spam placement;
   - Gmail one-click unsubscribe;
   - native-speaker review of the Arabic.


# PART 2: the rest of the app (`build/phase-1`)

## K. Database security, complete inventory

1. **Inventory.** Dump every table, view, sequence, function, trigger, policy and grant, for `public`, `anon`, `authenticated` and `service_role`.
2. **Access matrix test.** For every table, as anon, user A and user B, attempt each of select, insert, update, delete, truncate and upsert. Write the result as a matrix. Every allowed operation needs a reason; anything allowed without one is a finding.
3. **Function lock-in.** These must not be executable by anon or authenticated:
   - `settle_match`, `set_players`, `set_match_start`, `lock_match_now`, `pause_settlement`, `request_refetch`, `reseat_paused_match`;
   - `ingest_result`, `ingest_heartbeat`, `kick_poller`, `watchdog`, `watchdog_check`;
   - `export_optins`, `billing_report`, `snapshot_billing`, `hand_over_leagues`, `close_rank_gap`, `rank_new_fan`.

   They are not executable today. Add tests that **lock this in**, so a future migration cannot quietly reopen them.
4. **Default privileges.** In Postgres, new functions are executable by `PUBLIC` unless default privileges say otherwise. Check whether they do. If not, report SMELL: every future function is exposed unless someone remembers to revoke it.
5. **Every `security definer` function:**
   - `search_path` is pinned;
   - it never trusts a user id passed in as a parameter;
   - it handles `auth.uid() is null`.
6. **Views.** Check for views that write through to tables (auto-updatable, `security_invoker` off, owned by postgres, with a broad grant). One of these was a real write path in Grand Slam GM.
7. **Known leak to verify.** The `picks` policy lets **any signed-in user read every pick of any started match**, across all leagues.
   - That reveals the total number of players (a count of picks on match 1), and it bypasses the 50-pick threshold that `get_match_crowd` is meant to enforce.
   - Check whether any client code depends on reading other users' picks directly rather than through `get_league_picks` or `get_match_crowd`.
   - Report both, with a proposed own-rows-only policy as a patch (Rule 4).
8. Run `supabase db lint`. Report every warning.

## L. Sign-in and accounts

1. **The full email-code flow:**
   - expiry;
   - reuse of an old code;
   - wrong-code lockout (`too_many_requests` / `err_too_many_attempts`);
   - resend throttling;
   - `no_password_before_proof`: no password can be set before the email is proven.
2. **Captcha (Turnstile) is enforced on the server**, in the Supabase auth config, not only in the UI. Prove it: sign up through the API with no captcha token.
3. **Account enumeration.** `no_account` tells a stranger whether an email is registered. Report it as SMELL, with the trade-off.
4. **`clean_display_name`.** Feed it:
   - zero-width characters;
   - RTL override (U+202E);
   - combining marks;
   - emoji;
   - 1 character and 25 characters;
   - only spaces;
   - names imitating staff ("Admin", "Call the Crown").
5. **`delete_account`.** After deletion, nothing about the user may remain in:
   - `profiles`, `picks`, `standings`, `league_members`, `league_removals`, `activity_days`, `consents`;
   - `auth.users`;
   - owned leagues, which `hand_over_leagues` must hand to the next member or delete when empty.

   Also check that standings and ranks are recomputed correctly afterwards. Whether consent history should be kept as legal evidence is a question for Tino: report it, don't decide it.
6. **Session handling:** an expired session mid-pick, two tabs open, sign-out in one tab.

## M. Scoring engine, end to end

1. **Property tests: 10,000 random cases**, run through both the app and the independent oracle (`tests/verify/oracle.ts` from Part 1 D, or build it here; no app code imports). Cover:
   - every legal and illegal set score: `allowed_set_scores`, 7-5, 7-6, scores from the loser's side;
   - a third set only after a split;
   - "deciding set: full";
   - 2-set and 3-set picks against 2-set and 3-set results;
   - retirements and walkovers, where only the winner counts, for everyone.
2. **The upset formula.** `winner points × (1 + gap ÷ (gap + 30))`, "rounded to a whole point, halves round up".
   - Find gaps where the exact value lands on .5 and check the SQL rounds **up**. Postgres `round()` on `double precision` rounds halves to even, so the result depends on the type.
   - Check that the published `p1_win_points` / `p2_win_points` match the formula, using the rankings fixed before the first match.
3. **Orientation.** `orient_set_scores` and the p1/p2 flip. The same real result entered from either player's side must score identically.
4. **Tiebreak chain**, exactly as How to play describes it:
   1. exact sets;
   2. final total games, closest wins;
   3. earliest final pick, where the last change counts;
   4. the seeded draw.

   Build 4-way ties that reach each level. Recreate the seeded draw independently from `event_config.tiebreak_seed` and the documented method. Prove `guard_tiebreak_seed` blocks any change after launch.
5. **The bracket.** `advance_bracket` must route:
   - quarter-final winners into the semi-final p2 slots;
   - semi-final losers into the 3rd-place match;
   - semi-final winners into the final.

   **Correction case:** a quarter-final result is corrected **after** semi-final picks were saved on the wrong player. What happens to those picks, the bracket, and the points? Report the exact behaviour. It is a rule question for Tino.
6. **Re-settlement.** A result corrected after settling (`result_rev`) recomputes points exactly once: no double counting, and standings stay identical to a fresh recompute. Run it twice and compare.
7. **Mid-event sign-ups.** `rank_new_fan` and `close_rank_gap` keep ranks dense and correct when users join mid-event.

## N. Pick locking and concurrency

1. `save_pick` is rejected on the server once `starts_at <= app_now()`. Test 1 second before, at the exact second, and 1 second after.
2. **Fifty concurrent `save_pick` calls** around the lock second: none after the lock is accepted, none before it is lost, no duplicate rows.
3. **`set_match_start` moves a match earlier** after picks exist, and `lock_match_now`: picks lock immediately, and nothing saved after the new start survives.
4. **Tampered requests through the raw API:**
   - a winner who isn't in the match;
   - `sets = 3` with 2 scores;
   - a third set after 2-0;
   - a loser who wins two sets;
   - strings in place of numbers;
   - an oversized JSON payload;
   - a pick for a match whose players aren't known yet.
5. **The 2-set → 3-set rule:** "sets 1 and 2 can still be exactly right" when you picked 2 sets and the match went to 3.

## O. Results pipeline

1. **Offline fixtures** for the Wikipedia provider, with `poll-results` run against each one:
   - a normal final result;
   - a **live partial score**, which must not settle;
   - a retirement mid-set;
   - a walkover;
   - an edit that is vandalised and then reverted inside 10 minutes (`stable_minutes`), which must not settle on the vandal's score;
   - a player name spelled differently;
   - HTTP 429, 500, a timeout, malformed JSON, an empty page.
2. **`provider_map` completeness:** all 6 players and 6 matches for every provider in use.
3. **`result_log`** is immutable. `pause_settlement` and `reseat_paused_match` behave as named.
4. **Who can trigger `poll-results`?** If any signed-in user can call it, a user could make the app hammer Wikipedia from its own address and get it rate-limited or blocked in the middle of the event. Report the severity.
5. **One live read-only check:** fetch each Wikipedia page referenced in `provider_map` once.
   - Does it exist today?
   - Does the parser understand its current format?

   If the page doesn't exist yet, say when it will need to, and what happens on night 1 if it still doesn't: the parser must fail safe, which means no settlement and an alert.
6. **Alerting.** Where do `ops_alerts` and `watchdog` failures go?
   - If they only land in a table nobody watches, report BUG: during the event a broken feed would go unnoticed.
   - Propose the smallest notification, for example a Discord webhook.

## P. Front end, every screen

1. **Every route**, in EN and AR, at 360, 390, 768 and 1280 px wide. For each, cover the loading, empty, error, offline (network cut mid-save) and session-expired states. Save screenshots to `tests/verify/screens/`.
2. **Zero console errors or warnings** in a full click-through. List each one.
3. **Deep links survive a refresh** on the production build served the way Cloudflare Pages serves it (check the SPA fallback): `/leagues?code=…`, `/picks`, `/results`, `/unsubscribe?…`.
4. **Times.** Every time on screen says which timezone it's in, and the user's local time and Riyadh time never get mixed up. Test with a browser in Europe/Madrid, Asia/Riyadh and America/New_York.
5. **Analytics actually fire.** Capture the network calls to PostHog during the click-through. List events sent against events in the code, and flag any event in the code that never fires. Dead tracking has misled analysis before.
6. **Accessibility basics:** keyboard-only path through sign-in and a pick, labels on icon buttons, contrast of muted text on the dark background.
7. Run `npm audit` and list outdated packages with known vulnerabilities.
8. **Hosting headers** on the built site:
   - CSP;
   - HSTS;
   - `X-Frame-Options` / `frame-ancestors` (clickjacking);
   - `Referrer-Policy`;
   - cache rules for `index.html` (a stale page after a deploy);
   - whether source maps are publicly served.

## Q. Config and data sanity

1. **The rules agree everywhere.** The numbers in How to play (EN and AR) match `event_config.rules`:
   - winner points: QF 8, SF 13, 3rd place 8, F 20;
   - set points: 4, 6, 4, 10;
   - 2 points per exact set;
   - upset constant 30;
   - `htp_max` correct for 6 matches all ending in 2 sets.

   Recompute each from config and compare to the copy.
2. **Match schedule.** Produce a table of the 6 `starts_at` values in UTC and Riyadh time, for Tino to check against the public schedule. You can't confirm the official times yourself, so don't claim to. The times came from the organiser, who is no longer involved.
3. **Dead code from the organiser deal.** List everything that existed only for it, for Tino to decide on, and do not remove any of it:
   - `billing_report`, `snapshot_billing`, `billing_snapshots`, `billing_close_at`;
   - `export_optins('organiser')`, the organiser consent;
   - `sponsor_slots`;
   - the prize config.
4. **Test and staff accounts** (`is_test`, `is_staff`) never appear in public rankings, crew boards, crowd percentages or rarity shares. Check each one.
5. **Size leaks across the whole app:** every place a count of users, picks, leagues or members reaches the browser, through the UI or any API response. Known: the `picks` policy (K7) and the leaderboard's `total`. List them all for a decision.

## R. Part 2 report (reply with this, in this order)

1. **Verdict: GO or NO-GO** for running the event on this code.
   - GO requires all four: zero open BUG/SECURITY findings; every section K to Q actually run; the M oracle in full agreement; O5 confirming the feed works.
   - Otherwise NO-GO, with the reason.
2. **Findings**, ranked BUG/SECURITY → SMELL → OPTIONAL. For each:
   - file and line;
   - what is wrong;
   - how to reproduce it;
   - the failing test's name;
   - fixed, or a proposed patch path (Rule 4).
3. **The access matrix (K2)** and the size-leak list (Q5).
4. **Decisions needed from Tino**, each with your recommendation:
   - the bracket correction rule (M5);
   - consent history on deletion (L5);
   - the `picks` policy (K7);
   - dead code (Q3);
   - the match times to confirm (Q2);
   - alerting (O6).
5. **Not verifiable here**, to be checked by a person:
   - real phones;
   - real email delivery;
   - the official schedule;
   - a native-speaker read of the Arabic;
   - Wikipedia's page format on the night.
