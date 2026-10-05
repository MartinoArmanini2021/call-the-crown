# Brief: Call the Crown — bragging rights, no prizes

Repo: `six-kings-game` (Call the Crown). Supabase project ref `rmjlqqzytahmdlmnwxfc`. That is the only database this app has: treat it as live.

## Context (read first)

The organiser walked away. Call the Crown now runs independently, with **no prizes of any kind**. The only incentive is bragging rights between people who know each other. Everything below serves one loop:

**make a league → pick → share → friend joins → beat them**

Decisions already made. Do not reopen them:
- No prizes, no prize pool, no Joker, no rewards for inviting.
- No organiser branding anywhere. The words "Six Kings" and "Slam" never appear.
- No player photos in generated images.
- Never show absolute user counts or pick counts, and never send them to the browser. Percentages appear only when at least 50 people picked that match.
- The Arabic copy in this brief is final pending a native-speaker review. Use it verbatim; do not rewrite or machine-translate it.

Reference files, if present in `docs/briefs/bragging-rights/`:
- `1-my-call-en.png`, `2-i-called-it-en.png`, `3-i-called-it-ar-perfect-night.png`, `4-my-call-ar.png`: share card mockups. Match them.
- `card-reference.html`: the mockups' layout as HTML/CSS. It is a reference, not code to ship.

## Guardrails (all phases)

1. **Working branch only:** `feat/bragging-rights`, from `main`. One commit per phase. Never push to `main`.
2. **No deployment of any kind.** No Cloudflare deploy, no `supabase db push`, no `supabase functions deploy`, no secrets set on the remote project. Migrations and functions are written as files and tested on the **local** Supabase stack only.
3. **No scoring changes.** Do not modify `save_pick`, `score_match`, `settle_match`, `refresh_match_points`, `win_points`, `validate_*`, `canonical_set_scores`, `recompute_standings`, the tiebreak logic, or `event_config.rules`.
4. **No result-ingest changes.** Do not modify `poll-results`, `ingest_result`, `kick_poller`, or the `poll-results` and `watchdog` cron jobs.
5. **No security changes to what exists.** Do not change any existing RLS policy or grant. New tables get RLS on and **no** client grants. Clients reach them only through new `security definer` functions that use `auth.uid()`. Every new function: `set search_path = public`; revoke execute from `public` and `anon`; grant execute to `authenticated` (or `service_role` for server-only functions).
6. **No historical data changes.** The only data changes allowed are the `event_config` changes named in Phases 1, 3 and 4.
7. **Do not touch** `update_consents`, the privacy notice text, or the organiser consent. They wait on a legal rewrite that is out of scope.
8. Colours come from existing CSS tokens. Do not introduce `#e50914` or any new red. Gold `#f2c14e` is already in the stylesheet: reuse it, and add a `--gold` token if none exists.

**Stop and ask (do not work around) if:**
- a guardrail would have to break to finish a phase;
- the baseline tests or build fail before you change anything;
- the local Supabase stack does not start: finish Phase 1 (copy only), then stop;
- the app's existing night grouping (`night_1` to `night_3`) disagrees with the server's grouping in Phase 5.

## Phase 0: Baseline (no commit)

1. Create the branch.
2. Run the existing tests and the production build. Record the commands and the pass counts.
3. Run `supabase start` and `supabase db reset`. Confirm every migration applies cleanly on the local stack.

## Phase 1: Remove prizes and betting language (~45 min)

**Build:**
- Remove every prize UI element:
  - the landing prize block (`landing_prizes`);
  - `prize_terms` and the leaderboard terms link (`terms_url`);
  - any component that reads `event_config.prizes`.
- New migration: set `event_config.prizes = '[]'::jsonb`.
- New migration: add `rarity_min_picks: 50` to `event_config.flags`.
- Change `get_match_crowd` so that pick counts never reach the browser:
  - when the match has fewer than `rarity_min_picks` picks, it returns no row;
  - otherwise it returns percentages (`p1_share`, `p2_share`, `top_share`, each `numeric(5,1)`) instead of counts.

  Keep the frozen-snapshot behaviour of the `match_crowd` table exactly as it is. This is the only existing function you may change. A new return type means drop and recreate, and dropping a function deletes its grants: record its current grants first, re-apply exactly those, and show them before and after in the report.
- In the Results crowd panel ("How fans picked"):
  - remove the absolute count (`crowd_picks` / `crowd_pick_one`) and show percentages only;
  - when the function returns no row, hide the whole panel.
- Copy changes, both locales (exact strings below):

| key | EN | AR |
|---|---|---|
| `landing_sentence` | Predict the winner and the score of all {n} matches. Every call you get right scores points. Top the table and take the crown. | توقّع الفائز ونتيجة المباريات الـ{n} كلها. كل توقع صحيح يمنحك نقاطاً. تصدّر الترتيب وانتزع التاج. |
| `landing_league_line` (new, under the landing title) | Make a league for your group. Settle who knows tennis. | أنشئ دورياً لمجموعتك، وأثبتوا من يفهم في التنس. |
| `friends_no_prizes` → rename to `leagues_bragging` | No prizes, just bragging rights. | لا جوائز، فقط حق التفاخر. |
| `htp_upset` | Pick the lower-ranked player and score more if they win. The bigger the gap in the world ranking, the bigger the bonus. | اختر اللاعب الأقل تصنيفاً واحصل على نقاط أكثر إذا فاز. كلما كان الفارق في التصنيف العالمي أكبر، كانت المكافأة أكبر. |

**Audit:** grep both locale files and all components, case-insensitive:
- English: `prize|wager|odds|stake|gambl|\bbet\b|win more`
- Arabic: `جائز|جوائز|راهن|رهان|مراهن|اربح`

Allowed hits: the "no betting" fine print added in Phase 3 (`بلا رهانات` / "no betting"). Report every other hit, with a reason for each.

**Definition of done:**
- The audit is clean apart from allowed hits.
- Landing, leaderboard and Results show no prize content in EN or AR.
- An SQL test proves `get_match_crowd` returns no row at 49 picks and shares, not counts, at 50.
- The crowd panel shows no counts and stays hidden below 50 picks.
- Tests pass.

## Phase 2: Leagues first (~60 min)

**Build:** front-end only. If a server change turns out to be needed, stop and ask.

1. **Landing.**
   - Primary button: **Start a league** → sign up → create league → invite sheet opens.
   - Secondary button: **Join with a code**.
   - Text link: **Or play on your own** → the current flow.
   - Signed in with no league: keep **Make your picks** and add **Start a league**.
2. **Invite links.** These already work as `${origin}/leagues?code=XXXXXX`. A signed-out visitor who opens one must end up in that league after signing up, without retyping the code:
   - keep the pending code in `sessionStorage` through the auth flow;
   - consume it once;
   - call `join_league`;
   - show the existing `joined` toast.
3. **One-time step after first sign-in.** Show it when the user has no league and no pending code: "Who are you playing against?" with **Create**, **Join**, and **Not now**. Remember the dismissal per user in `localStorage`, wrapped in try/catch.
4. **Rank line on the picks screen** for the active league.
   - Active league: the most recently created or joined, or the one the user picks (stored in `localStorage`).
   - Data: `get_leaderboard(p_league)` or `get_rank_window`.
   - Before the first result, show the `board_empty` copy instead of a rank.
   - If the league has only the user, show the nudge and an **Invite** button that reuses the existing share handler and the `invite_shared` event.

| key | EN | AR |
|---|---|---|
| `cta_start_league` | Start a league | أنشئ دورياً |
| `cta_join_code` | Join with a code | انضم برمز |
| `cta_solo` | Or play on your own | أو العب بمفردك |
| `onboard_title` | Who are you playing against? | ضد من ستلعب؟ |
| `onboard_sub` | Make a league for your group, or join one with a code. You can do it later too. | أنشئ دورياً لمجموعتك أو انضم إلى دوري برمز. يمكنك فعل ذلك لاحقاً أيضاً. |
| `league_rank_line` | #{rank} of {n} in {league} | المركز {rank} من {n} في {league} |
| `league_alone_nudge` | Your league is just you. Send the invite: no rivals, no bragging. | دوريك فيه أنت فقط. أرسل الدعوة: لا تفاخر بلا منافسين. |

**Definition of done:** each scenario below works in EN and AR. Save a screenshot of each at 390 px wide to `docs/briefs/bragging-rights/screens/`.
- (a) Invite link → sign up → already in the league.
- (b) Landing → Start a league → league exists and the invite sheet is open.
- (c) The one-time step shows exactly once.
- (d) Picks screen shows the rank line, plus the alone nudge when relevant.
- (e) Layout is correct right-to-left in AR.

Tests pass.

## Phase 3: Share cards (~135 min)

### Server

1. New function `get_my_call_stats(p_match int)`, `security definer`, `stable`.
   - Returns: `threshold_met bool`, `picks_total int`, `same_winner int`, `same_exact int`.
   - Returns no row unless: the caller is signed in, has a pick on `p_match`, and the match has started (`starts_at <= app_now()`).
   - When the number of picks for the match is below `rarity_min_picks`, return `threshold_met = false` with all three counts NULL. **The threshold is enforced on the server. Counts below it must never reach the client.**
   - `same_winner`: picks with the caller's `winner_id`.
   - `same_exact`: picks with the same `winner_id` and an equal `canonical_set_scores(set_scores)`.
   - Count picks the same way `get_match_crowd` does.

### Client

Render with Canvas 2D at 1080×1350 PNG, under 1 MB.
- Before drawing, wait on `document.fonts.load` for every family and weight used.
- **Arabic font:** if the app already ships one, use it. Otherwise add `@fontsource/noto-kufi-arabic` (weights 500, 700, 800), loaded only for AR.
- Set `ctx.direction = 'rtl'` for AR. Set 1 sits on the right.
- No `<img>` from other origins: player photos are excluded, and they would also break canvas export.

**Card types:**
- **My Call.** Offered from the saved-pick toast and on any open match card where the user has a pick. Content: chip, round and night, the scoreboard of the pick, "What's your call?", and the closing time in Riyadh time.
- **I called it.** Offered on Results for every settled match where `picks.winner_id = matches.winner_id`. Two variants:
  - **Exact** (every played set exact): headline "I called it.", EXACT tick under every set.
  - **Winner only:** headline "Called the winner.", ticks only under sets that were exact.
  - Retired or walkover matches: winner-only variant, no set ticks, plus the `card_void` line.
- **Rarity line.** Only when `threshold_met`:
  - Exact variant: show it when `same_exact / picks_total ≤ 20%`.
  - Winner-only variant: show it when `same_winner / picks_total ≤ 40%`.
  - Above those limits, show no rarity line. Never brag about a majority pick.
  - Percent format: whole number rounded down. Below 1%, use the `pct_under_1` string.
- **Footer.**
  - In a league: `card_join` + the active league code (Phase 2) + `window.location.host`.
  - In no league: `card_play_free` + host.
  - Always: the fine print.
- **Sharing.**
  - If `navigator.canShare({ files })` is true: `navigator.share({ files: [png], text })`.
  - Otherwise: download the PNG and copy the text to the clipboard, then show `share_fallback`.
  - Share text includes `${origin}/leagues?code=CODE`, or `origin` when the user has no league.
- **Analytics** (existing helper, no personal data): `call_card_opened` and `call_card_shared`, each with `{ kind: 'my_call' | 'called_it', match_no, method: 'share' | 'download', locale }`.

| key | EN | AR |
|---|---|---|
| `card_my_call` | MY CALL | توقعي |
| `card_whats_yours` | What's your call? | وما توقعك أنت؟ |
| `card_closes` | Picks close {day} · {time} Riyadh time | تُغلق التوقعات {day} · {time} بتوقيت الرياض |
| `card_called_it` | I called it. | توقعتها. |
| `card_called_winner` | Called the winner. | توقعت الفائز. |
| `card_exact` | EXACT | صحيحة |
| `card_rarity_exact` | Only {share} of fans called this exact score. | {share} فقط من المشجعين توقعوا هذه النتيجة بالضبط. |
| `card_rarity_winner` | Only {share} backed {name}. | {share} فقط اختاروا {name}. |
| `pct_under_1` | under 1% | أقل من 1% |
| `card_void` | Retirement: only the winner counts. | انسحاب: يُحتسب الفائز فقط. |
| `card_join` | Join my league | انضم إلى دوري |
| `card_play_free` | Play free | العب مجاناً |
| `card_fine` | Free to play. No money, no betting. | مجانية. بلا مال وبلا رهانات. |
| `share_my_call` | Share my call | شارك توقعي |
| `share` | Share | شارك |
| `share_fallback` | Image saved. Link copied. | تم حفظ الصورة ونسخ الرابط. |
| `share_text_my_call` | My call for {match}. Think you know better? Join my league: {url} | توقعي لمباراة {match}. تظن أنك تعرف أكثر؟ انضم إلى دوري: {url} |
| `share_text_called` | I called it: {score}. Join my league: {url} | توقعتها: {score}. انضم إلى دوري: {url} |

**Definition of done:**
- **SQL tests for `get_my_call_stats`:**
  - before the start → no row;
  - caller without a pick → no row;
  - 49 picks → `threshold_met = false` and NULL counts;
  - 50 picks → correct counts;
  - same score in a different set order → counted as exact via the canonical form.
- **Six PNG snapshots** saved to `docs/briefs/bragging-rights/cards/`:
  - My Call EN;
  - My Call AR;
  - exact EN;
  - exact AR;
  - winner-only EN with a rarity line;
  - void EN.
- Each PNG is under 1 MB, and the Arabic is shaped (joined letters) and laid out right to left.
- Tests pass.
- Add to the report a **manual check list for Tino**: sharing on iPhone Safari and on Android Chrome, into WhatsApp.

## Phase 4: Crews (~90 min)

### Server

1. Migration:
   - add `leagues.crew_hidden boolean not null default false` (for staff moderation, set by SQL only; no function exposes it);
   - add `crew_min_members: 5` to `event_config.league_limits`.
2. New function `get_crew_board(p_limit int default 10)`, `security definer`, `stable`.
   - **Eligible:** leagues with at least `crew_min_members` members and `crew_hidden = false`. Count members using the same test-account rule the global ranking uses.
   - **Score:** the average `standings.points` of the league's best 5 members. A member with no standings row counts as 0.
   - **Tiebreak:** sum of the best 5 members' `exact_sets` (descending), then `leagues.created_at` (ascending), then `id`.
   - **Returns:** `rank`, `league_id`, `name`, `avg_points numeric(6,1)`, `is_mine`.
   - Returns the top `p_limit` rows **plus** any of the caller's own eligible leagues outside the top.
   - Never returns member counts or the total number of eligible leagues.
   - Names are trimmed and cut to 24 characters, using the same cleaning as `clean_display_name`.

### Client

- Leaderboard gets a **Crews** tab next to Global and the user's leagues. It shows:
  - the rule line;
  - the top 10;
  - the user's own crews;
  - for each of the user's leagues below 5 members, the "needs N more" line with an **Invite** button.
- Once the final is settled, the #1 crew carries the `crew_crowned` label.

| key | EN | AR |
|---|---|---|
| `crews_tab` | Crews | تحدي الدوريات |
| `crews_title` | Top crews | تحدي الدوريات |
| `crews_rule` | Leagues with 5 or more members, ranked by the average points of each league's best 5. | الدوريات التي تضم 5 أعضاء أو أكثر، مرتبة حسب متوسط نقاط أفضل 5 أعضاء في كل دوري. |
| `crews_needs` (n=1) | {league} needs 1 more member to enter. | يحتاج {league} إلى عضو إضافي واحد للدخول. |
| `crews_needs` (n=2) | {league} needs 2 more members to enter. | يحتاج {league} إلى عضوين إضافيين للدخول. |
| `crews_needs` (n=3–4) | {league} needs {n} more members to enter. | يحتاج {league} إلى {n} أعضاء إضافيين للدخول. |
| `crews_yours` | Your league: #{rank} | دوريك: المركز {rank} |
| `crews_empty` | No league has 5 members yet. Yours could be first. | لا يوجد دوري فيه 5 أعضاء بعد. قد يكون دوريك الأول. |
| `crew_crowned` | Crowned crew | الدوري المتوَّج |

**Definition of done:**
- **SQL tests** with fixture data:
  - a 4-member league is excluded;
  - a 5-member league is included;
  - an 8-member league averages only its best 5;
  - the tiebreak works;
  - a hidden league is excluded;
  - the caller's own league appears beyond `p_limit`;
  - no count columns exist in the output.
- Screenshots EN and AR.
- Tests pass.

## Phase 5: Perfect Night and night reminders (~90 min)

### Perfect Night

- New function `get_my_badges()`, `security definer`, `stable`.
  - **Night:** the date of `starts_at` in `event_config.timezone`, numbered 1 to 3.
  - **Complete:** every match of the night has `settled_at` set.
  - **Perfect:** the caller has a pick on every match of the night, and `picks.winner_id = matches.winner_id` for each one.
  - Returns `night_no` and `perfect`.
- **Check first:** confirm this grouping matches the client's existing `night_1` to `night_3` labels. If they disagree, stop.
- **UI:**
  - badge on the Results header and on Profile;
  - **Perfect Night ribbon** on any "I called it" card for a match in a perfect night (see mockup 3).

### Reminders (opt-in only)

1. **Consent.** New consent party `reminders`, with `text_version` `reminders-1`.
   - New function `set_reminder_optin(p_on boolean)` writes it, following the pattern of `update_consents` without modifying it.
   - A checkbox at sign-up, **unticked by default**, and a toggle on Profile.
2. **Send log.** New table `reminder_sends(user_id uuid, night_no int, status text check (status in ('sent','failed','dry_run')), at timestamptz default now(), primary key (user_id, night_no))`. RLS on, no client grants.
3. **Edge function `send-reminders`.**
   - **Trigger:** a new pg_cron job `send-reminders` every 5 minutes. Read `kick_poller` and copy how it calls an edge function and authenticates; don't invent a new pattern.
   - **Window:** a night qualifies when its first match starts within the next 2 hours and hasn't started.
   - **Recipients:** latest `reminders` consent is true; at least one match that night has both players known, hasn't started, and has no pick from this user; no `reminder_sends` row exists for this user and night.
   - **Idempotency:** claim each recipient with `insert … on conflict do nothing returning` **before** sending, so two runs at once can never send twice.
   - **Failures:** mark `failed` and add an `ops_alerts` row. Never retry automatically.
   - **Email:** sent through the Resend REST API using env `RESEND_API_KEY`, from env `REMINDER_FROM` (the same sender as the login emails), with links built from env `PUBLIC_APP_URL`. Written in `profiles.locale`; the AR version uses `dir="rtl"`. Plain, text-first HTML.
   - **Dry run:** if `RESEND_API_KEY` is missing, write `dry_run` rows and an `ops_health` line, and send nothing.
4. **Unsubscribe.**
   - Each email carries an HMAC token over `user_id`, signed with env `REMINDER_UNSUB_SECRET`.
   - The link opens `/unsubscribe?u=…&t=…`, a page with one button that POSTs to edge function `reminder-unsubscribe`, which sets the consent to false.
   - Add `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers pointing at the same function.
   - **A GET request must never unsubscribe**: email link scanners would trigger it.
   - A bad token returns 403.

| key | EN | AR |
|---|---|---|
| `reminder_optin` | Email me 2 hours before picks close each night | أرسل لي بريداً قبل إغلاق التوقعات بساعتين كل ليلة |
| `perfect_night` | Perfect Night {n} | ليلة مثالية {n} |
| `perfect_night_sub` | Every winner right on night {n}. | كل الفائزين صحيحون في الليلة {n}. |
| `card_perfect_ribbon` | PERFECT NIGHT | ليلة مثالية |
| email subject | Picks close in 2 hours | تُغلق التوقعات بعد ساعتين |
| email line 1 | Night {night} starts at {time} Riyadh time. | تبدأ الليلة {night} الساعة {time} بتوقيت الرياض. |
| email line 2 | You haven't called {open} of tonight's {total} matches yet. | لم تتوقع بعد {open} من مباريات الليلة الـ{total}. |
| email button | Make my picks | سجّل توقعاتي |
| email league line (omit if no rank yet) | You're #{rank} of {n} in {league}. | أنت في المركز {rank} من {n} في {league}. |
| email footer | You're getting this because you asked for reminders. Turn them off: {unsub} | تصلك هذه الرسالة لأنك طلبت التذكير. لإيقافه: {unsub} |
| `unsub_title` | Stop reminder emails? | إيقاف رسائل التذكير؟ |
| `unsub_button` | Turn off reminders | أوقف التذكيرات |
| `unsub_done` | Reminders are off. | تم إيقاف التذكيرات. |

**Definition of done:**
- **Tests:**
  - night grouping;
  - perfect and not-perfect cases, including a missing pick and a retirement;
  - recipient selection: opted out, all picked, players unknown, already sent;
  - two concurrent runs send exactly once;
  - dry run when the key is missing;
  - a GET to unsubscribe changes nothing;
  - a bad token returns 403.
- Rendered emails, EN and AR, saved as HTML to `docs/briefs/bragging-rights/emails/`.
- Tests pass.

## Phase 6: Funnel query (~10 min)

Add `supabase/queries/funnel.sql`. It is read-only and excludes test accounts. It returns:
- sign-ups since `launch_at`;
- % of sign-ups with at least 1 pick;
- % in a league with at least 2 members;
- % in a crew-eligible league;
- reminder opt-in %.

Every percentage has one decimal place.

## Final report (reply with this, in this order)

1. **Review checklist**, each answered explicitly:
   1. Were the tests run? List the commands and pass counts, baseline vs now.
   2. Did anything gain a write path? List every new `security definer` function and exactly what it writes.
   3. RLS and grants: list every new table, policy and grant. Confirm that no existing policy or grant changed.
   4. Cron: confirm exactly one new job (`send-reminders`), and that `poll-results` and `watchdog` are untouched.
2. **Per phase:** files changed, migrations added, screenshot and snapshot paths.
3. **Everything you could not verify yourself**, including the mobile share checks.
4. **Open questions**, and anything you stopped on.
