# Six Kings Slam Predictor

A free prediction game licensed to the organiser of the Six Kings Slam (Riyadh, 21, 22 and 24 October 2026). Fans pick, for every match, the winner, the number of sets and the score of every set. Results arrive automatically from a results provider; no person ever types one.

It is built as a **template**: one event per instance. A new licensee is a new Supabase project, a new Pages project and a new event file. No new code.

- **Stack:** React 19 + TypeScript + Vite + TanStack Router + Tailwind 4, a static single-page app on Cloudflare Pages. Supabase (Postgres + Auth) behind it. `bun` for everything.
- **Where the rules live:** `event_config.rules` (one row). Every lock, score and rank is decided in Postgres; the app only shows stored numbers.
- **Working rules:** [AGENTS.md](AGENTS.md).

Status: **Phase 1 (local).** No cloud resources exist yet.

---

## Contents

1. [How it works](#how-it-works)
2. [Run it locally](#run-it-locally)
3. [Tests and checks](#tests-and-checks)
4. [Runbook](#runbook): set up an event · players and schedule · provider ids · pause and re-fetch · billing report · opt-in export · audit
5. [Auth settings per instance](#auth-settings-per-instance)
6. [Repository map](#repository-map)
7. [Decisions taken in Phase 1, and what is still open](#decisions-taken-in-phase-1-and-what-is-still-open)

---

## How it works

Think of a sealed ballot box. Fans drop in a slip per match until the match starts. The box is sealed by a clock only the server reads. When the match ends, the result does not come from anyone at a desk: it arrives from the results provider, is checked, and the database marks every slip and re-ranks the table in one go.

```
fan ──save_pick()──▶ picks ─┐                         (writes the billing day too: activity_days)
                            │
provider ──poll-results──▶ ingest_result() ──▶ settle_match() ──▶ picks.pts_* (breakdown)
  (every minute,            │ checks, logs                       ──▶ standings (strict ranks)
   from 15 min before        ▼ every payload                     ──▶ next round's players
   each start)           result_log (append-only)
```

- **One write path per thing.** Fans write only through RPCs (`save_pick`, the league RPCs, `update_profile`, `update_consents`, `delete_account`). The operator writes only through service-role RPCs (`set_players`, `set_match_start`, `pause_settlement`, `request_refetch`). Results are written only by `ingest_result`, called only by the poller.
- **No human path to a result, in four layers:** no table grants for anon/authenticated; no function a person can call takes a score (`ingest_result` excepted, service role only); a trigger refuses any change to a result, a pick's points or a standing outside settlement, even from the database owner; `result_log` keeps every raw payload and cannot be edited.
- **Idempotent settlement.** Scores are recomputed from the stored result, never added to. A corrected result from the provider re-settles from scratch, logs the before and after, and alerts.

## Run it locally

You need `bun`. Then:

```bash
bun install
cp .env.example .env
```

### Without Docker (the stand-in)

`scripts/dev-backend.ts` answers the Supabase calls this app makes, running the real migrations on an in-process Postgres. Use it when Docker is not installed. It listens on `127.0.0.1:55321` only.

```bash
bun run dev:backend
```

In a second terminal:

```bash
bun run dev
```

- The app is at http://localhost:5173.
- The **operator console** is at http://127.0.0.1:55321/_dev. It shows the simulated clock (with buttons for each moment of the event), the poller, the **mailbox** with the sign-in codes, the matches, `billing_report()`, the ops alerts and `result_log`.
- The data lives in memory: restarting the stand-in starts the event again from 20 Oct, 12:00 UTC.

The walkthrough (definition of done, item 3):

1. The event is already set up: invented players A–F, the bracket and the schedule (`supabase/dev/seed_local.sql`, through the same RPCs the operator uses). The quarter-finals are open.
2. Sign up in the app with a display name, an email ending in `@example.test` and the consents. Take the code from the console's mailbox.
3. Pick both quarter-finals: winner, sets, set scores.
4. Console: **21 Oct 08:00**, a new Riyadh day. Change a pick.
5. Console: **21 Oct 20:00**. The fixture provider publishes both quarter-final results (90 minutes after each start); the poller settles them and the semi-finals open.
6. Results shows the breakdown per component; Leaderboard shows the table and the top-3 prizes; the console's `billing_report()` counts the fan as qualified (picks on two days).

### With the Supabase CLI (Docker)

The same app against a real local Supabase. Docker Desktop must be running. The CLI is a dev dependency of this repo (`bunx supabase …`); nothing is installed globally. Stop the stand-in first: both use port 55321.

**Ports.** This project uses 55320–55329, not Supabase's default 54320–54329: Windows with WSL reserves a block of ports that, on this machine, covers the defaults (`netsh interface ipv4 show excludedportrange protocol=tcp` lists the reserved ranges).

1. Start Supabase. The first run downloads about 3 GB of images. Migrations, the event file, the simulated clock and the invented seed apply by themselves (`supabase/config.toml`, `[db.seed]`).

   ```bash
   bunx supabase start
   ```

2. Put the API URL and the anon key that `bunx supabase status` prints into `.env`. These are the standard local demo keys, not secrets.
3. Serve the results poller. `supabase/functions/.env` (git-ignored) contains `PROVIDER=fixture`.

   ```bash
   bunx supabase functions serve --env-file supabase/functions/.env
   ```

4. Let pg_cron call the poller every minute. Run each line as its own query (`bunx supabase db query "…"` or Studio at http://127.0.0.1:55323), with the local service key from `bunx supabase status`:

   ```sql
   select vault.create_secret('http://host.docker.internal:55321/functions/v1', 'functions_url');
   select vault.create_secret('<SERVICE_ROLE_KEY from supabase status>', 'service_role_key');
   ```

5. Start the app with `bun run dev`. Sign-in codes arrive in the local mail catcher (Mailpit) at http://127.0.0.1:55324.
6. Move the simulated clock in Studio or with `bunx supabase db query`:

   ```sql
   select public.dev_set_now('2026-10-21 20:00+00');
   ```

**The whole walkthrough as a script**, against this real stack (real Auth emails, RLS, pg_cron → edge function → settlement). It checks 21 claims. Afterwards, `bunx supabase db reset` puts the database back to the seed (redo step 4: the reset clears Vault).

```bash
bun scripts/walkthrough-local.ts
```

## Staging (Phase 2)

| What | Where |
|---|---|
| App (preview) | https://preview.six-kings-game.pages.dev (Cloudflare Pages project `six-kings-game`, branch `preview`; production branch `main` is not deployed) |
| Supabase | project `six-kings-game-staging`, ref `rmjlqqzytahmdlmnwxfc`, Frankfurt (eu-central-1), organisation Astra LTD, free plan |
| Data | the real 2026 draw with provisional ranks (`supabase/events/sixkings_2026_draw.sql`), then `supabase/staging/setup_staging.sql`: provider `fixture` (invented results mapped onto the real players), real clock (no simulated clock on staging) |
| Settings | `[remotes.staging]` in `supabase/config.toml`; public app values in `.env.staging`; the database password in `.env.staging.local` (git-ignored) |

Redeploy after a change (the CLI must be logged in: `bunx supabase login`; wrangler logged in to Cloudflare):

```bash
bunx supabase db push --linked
```

```bash
bunx supabase config push --project-ref rmjlqqzytahmdlmnwxfc
```

```bash
bunx supabase functions deploy poll-results --project-ref rmjlqqzytahmdlmnwxfc
```

```bash
bunx vite build --mode staging
```

```bash
bunx wrangler pages deploy dist --project-name six-kings-game --branch preview
```

One-off settings that hold secrets live only in the Supabase dashboard, entered by Tino, never in this repo:

- **Email sender:** Authentication → Emails → SMTP settings: Resend (`smtp.resend.com`, port 465, user `resend`, password = the Resend API key) from `mail.grandslamgm.com`. The free plan cannot change the sign-in email template without a custom sender, so the code-only email (`supabase/templates/code.html`) is pushed after SMTP is on.
- **The cron's key:** SQL editor, once: `select vault.create_secret('<service_role key>', 'service_role_key');`. The poller address (`functions_url`) is already in Vault.

Advisors on staging (Supabase dashboard or `get_advisors`): 0 ERROR. The remaining WARN and INFO entries are by design: fans call the security-definer RPCs, and the tables without a policy are reachable only through RPCs.

## Tests and checks

| Command | What it proves |
|---|---|
| `bun test` | The client and the server agree on every legal and illegal set score (`tests/vectors/set-scores.json` through both validators); the provider adapters translate correctly (Wikipedia on the real 2024 and 2025 brackets); the 2025 page replayed end to end through the poller and the database; the poller's watch window |
| `bun run test:sql` | `supabase/tests/scoring.sql`, `standings.sql`, `security.sql`, `stability.sql`: every scoring component, every tiebreaker, strict ranks, the full security list, and the stability rule (vandal edits, interruptions, corrections). Each file runs inside `begin … rollback` and prints one PASS/FAIL line per check |
| `bun run simulate` | The whole event end to end, as operator, fans and poller, with 22 checked claims |
| `bun run advisors` | The Supabase security advisor's ERROR-level checks against the migrations: must be 0 ERROR |
| `bunx tsc --noEmit` · `bun run build` · `bun run lint` | Types, build, lint |
| `bun scripts/settle-benchmark.ts [fans]` | Settlement time for N fans on the in-process database (indicative; the real test is `loadtest/settle-100k.sql` on staging) |

By default the SQL tests and the stand-in run on an in-process Postgres (PGlite) with a small stand-in for Supabase's `auth`, `vault`, `cron` and `net` (`supabase/dev/pglite_supabase_shim.sql`). With `supabase start` running, the same files run on the real local Supabase database (each still rolled back):

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres bun run test:sql
```

Supabase's own security and performance checks on the local database:

```bash
bunx supabase db advisors
```

Load tests (written, not run; staging only, after sign-off):

- `loadtest/k6-lock-rush.js`: the 10 minutes before a lock.
- `loadtest/settle-100k.sql`: settling one match for 100,000 fans, inside a rolled-back transaction.

---

## Runbook

All operator actions run in the Supabase SQL editor of the instance (as `postgres`), or through the API with the service key. **None of them takes a score.**

### Set up an event

1. Copy `supabase/events/sixkings_2026.sql` to `supabase/events/<event>.sql` and edit the values:
   - the name and the timezone;
   - `launch_at` and `billing_close_at` (the billing window);
   - `rank_snapshot_date`;
   - `rules` (only from the signed deck);
   - league limits, branding colours, prizes, the prize terms URL;
   - the privacy and consent texts **with a new `version`** whenever the wording changes;
   - sponsor slots and flags.
2. Run it once in the SQL editor. It is re-runnable: it upserts the single `event_config` row.
3. Upload the logo, prize and sponsor images, and the player images (organiser-supplied, with usage rights), to the instance's public storage bucket `event`. Reference them by path (`logo_path`, `image_path`).

**Sponsor slots.** Four fixed placements: `landing_strip`, `leaderboard_header`, `picks_footer`, `results_card`. Each entry is `{"slot", "image_path", "href", "alt": {"en", "ar"}}`; a slot with no entry renders nothing.

### Enter the players and the schedule

For 2026 this is one file, `supabase/events/sixkings_2026_draw.sql` (players, bracket, start times and the Wikipedia ids). It is marked provisional: replace the ranks with the ATP ranking of Monday 12 Oct 2026 before picks open, and the start times when the organiser's schedule arrives. The parts, for any event:

The players and the bracket (byes from the organiser's draw, never from ranking):

```sql
select public.set_players(
  '[{"id":"sinner","name":"Jannik Sinner","name_ar":null,"country":"ITA","seed":1,"rank":1,"image_path":"players/sinner.jpg"},
    …the other five…]',
  '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"<seed 3>"},"p2":{"type":"player","id":"<seed 6>"}},
    {"match_no":2,"round":"QF","p1":{"type":"player","id":"<seed 4>"},"p2":{"type":"player","id":"<seed 5>"}},
    {"match_no":3,"round":"SF","p1":{"type":"player","id":"<seed 1>"},"p2":{"type":"winner","match":1}},
    {"match_no":4,"round":"SF","p1":{"type":"player","id":"<seed 2>"},"p2":{"type":"winner","match":2}},
    {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
    {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]');
```

- `rank` is the snapshot used for the upset bonus. Once any pick exists, ids, ranks and the bracket are frozen; only names and images can change. Once a match has started, nothing can.
- p1/p2 is the fixed display order: set scores are always shown player 1's games first.
- Player images: the organiser's artwork, uploaded to the public `event` bucket (migration 0011; only the service role can write) as `players/<id>.jpg`, then `update public.players set image_path = 'players/<id>.jpg' where id = '<id>';`. Until then the app shows initials and names.

Start times, one per match, from the organiser's schedule. Each stays editable until that match starts and cannot be set in the past:

```sql
select public.set_match_start(1, '2026-10-21 19:30+03');
```

**A match starts early, or a walkover is announced before the start.** The poller reads each match from 60 minutes before its start, and a live or final reading before the scheduled start raises a `started_before_schedule` alert at once. Close the picks immediately:

```sql
select public.lock_match_now(1);   -- its start becomes this moment: picks for match 1 close now
```

The next poll settles it once the provider marks it final. (A final result that arrives before the start is refused, so no result is ever published while picks are open.) Whether picks saved after the real first ball are voided is a rule decision, still open.

### Choose the results provider and map its ids

The provider is the edge function's `PROVIDER` env. For 2026 (Tino, 1 Oct 2026): **Wikipedia now, Sportradar added if a contract lands**.

**Wikipedia** reads the event article's results bracket.

Env:
- `PROVIDER=wikipedia`
- `WIKIPEDIA_PAGE=2026 Six Kings Slam` (the article title, once someone creates it)
- `WIKIPEDIA_USER_AGENT=<app name> (<ops contact address>)`. Wikimedia asks for a contact, so use an ops address, not a personal one.

Ids:
- **Matches** are the bracket slots: QFs `RD1:3-4` and `RD1:5-6` (after the two byes), SFs `RD2:1-2` and `RD2:3-4`, the final `RD3:1-2`, third place `3rd:1-2`.
- **Players** are the article titles the names link to.
- Check the slots against the page once the draw is on it. Which QF feeds which SF follows the page's layout.

```sql
insert into public.provider_map (provider, kind, provider_ref, our_ref) values
  ('wikipedia', 'match',  'RD1:3-4',       '1'),
  ('wikipedia', 'player', 'Jannik Sinner', 'sinner');
```

What to know about this source:
- **Anyone can edit the page.** A result settles only after the page has shown exactly that result, without interruption, for **10 minutes** (`event_config.results_policy`). A vandal edit that is reverted never settles.
- **A settled result that the page later changes** raises an immediate `result_change_pending` alert. If the change holds for 10 minutes it re-settles as a correction. To stop that, pause the match.
- **Retirements and walkovers** are read from the page's markers: a small "r" or "ret." next to the score, and "w/o".
- **No start times** come from the page. The schedule is always the operator's.
- **Audit:** every reading in `result_log` keeps the page revision id, its link and the exact bracket lines it came from.
- **Tell the organiser:** the brief promised "an external API". Wikipedia is crowd-edited, so the results are typed by Wikipedia's editors (never by us). The organiser should know the source.

**Sportradar.**

Env:
- `PROVIDER=sportradar`
- `SPORTRADAR_API_KEY`
- `SPORTRADAR_ACCESS_LEVEL`

Ids: `sr:sport_event:…` for matches and `sr:competitor:…` for players. No waiting period.

For any provider:
- Every match and every player needs a row.
- The poller reports a missing match id in its heartbeat. `ingest_result` refuses a payload with an unmapped player and alerts (once an hour per match and reason).
- After a match settles, the poller keeps re-reading it for 12 hours (every run for 30 minutes, then every 10), so a provider's correction is seen.

### Pause and re-fetch a result

```sql
select public.pause_settlement(3, true);    -- payloads for match 3 are logged as "paused", nothing settles
select public.pause_settlement(3, false);   -- resume: the next poll settles the latest final payload
select public.request_refetch(3);           -- the next poll fetches match 3 whatever its window
select public.reseat_paused_match(3);       -- after bracket_conflict: take match 3's players from the corrected bracket and resume
```

**A corrected result changed a match that had already started** (`bracket_conflict`: that match is paused, and the provider's result for it, naming the real players, cannot settle while our match has the old ones). Run `reseat_paused_match(n)`: it takes the players from the corrected bracket, stores their potential points and resumes settlement. It takes no score; the provider's result then settles the match.

What the poller did, latest first:

```sql
select id, match_no, outcome, note, fetched_at from public.result_log order by id desc limit 20;
```

| Outcome | Meaning |
|---|---|
| `not_final` | The provider has no final result yet |
| `awaiting_stability` | A valid final result, not yet shown unchanged for the provider's waiting period (Wikipedia: 10 minutes) |
| `settled` | First settlement |
| `unchanged` | The same final result again |
| `resettled` | The provider changed a final result; rescored; `diff` holds before and after; alert sent |
| `paused` | Settlement is paused for this match |
| `rejected_invalid` | Illegal set, a winner inconsistent with the sets, wrong players, or a final before the scheduled start. `note` says which; alert sent |
| `rejected_unmapped` | The provider's match id is not in `provider_map`; alert sent |

The watchdog checks every 5 minutes and posts to the ops webhook (Vault secret `ops_webhook`, Discord or Slack):

- a match more than 4 hours past its start with no final;
- a rejected or changed result, and a settled result the provider now shows differently (`result_change_pending`, before it re-settles);
- a corrected result that changed a later match (`bracket_refilled`, or `bracket_conflict` when that match had started: its settlement is paused);
- a match the provider shows under way, or decided, before its scheduled start (`started_before_schedule`);
- a poller that is down or failing during a match window. Health is written once per poller run, healthy only if every match it visited was mapped and answered, so one failing match is never hidden by another.

### Pull the billing report

```sql
select public.billing_report();     -- {registered, verified, qualified, window, …} (service role only)
select public.snapshot_billing();   -- at event close: stores the report with its sha256
select * from public.billing_snapshots order by id desc;
```

A **qualified fan** is:

- an account on this instance;
- with a verified email;
- not flagged staff or test;
- that made or changed a pick on 2 or more distinct Riyadh days within the billing window.

The source is `activity_days`, written inside `save_pick` only when a pick is created or changed. The server picks the day; the client never does. PostHog is never used for billing.

Flag staff and test accounts before launch:

```sql
update public.profiles set is_staff = true where user_id in (…);
```

### Export the opt-in lists

```sql
\copy (select * from public.export_optins('organiser')) to 'optins-organiser.csv' csv header
\copy (select * from public.export_optins('gsgm'))      to 'optins-gsgm.csv'      csv header
```

- Each fan's latest answer counts.
- Only verified addresses are included, never test accounts.
- Each row carries the consent time and the version of the text the fan saw.
- The full history is in `consents`.

### Audit: every settled result matches the provider

```sql
select m.match_no, m.status, m.winner_id, m.set_scores, l.id as log_id, l.normalised
  from public.matches m
  left join lateral (select * from public.result_log r
                      where r.match_no = m.match_no and r.outcome in ('settled', 'resettled')
                      order by r.id desc limit 1) l on true
 where m.status <> 'scheduled';
```

Every settled match has a `settled`/`resettled` log row whose payload carries the same winner and set scores. A settled match without one would mean someone bypassed the guards with the owner password.

## Auth settings per instance

Set these in each Supabase project's dashboard; locally they are in `supabase/config.toml`.

**Sign-in**

- Joining: a 6-digit email code confirms the address once, then the fan chooses a password (at least 8 characters, `minimum_password_length`). Every later sign-in: email + password. "Forgot your password?" signs in with a code and offers a new password (Tino, 3 Oct 2026; the brief had code-only sign-in).
- The code email template shows `{{ .Token }}` and no link (`supabase/templates/code.html`).
- Production (Pro plan): turn on leaked-password protection (Authentication → Attack protection).
- No magic links, no Google or Apple, no anonymous sign-in.
- **"Confirm email" ON** (`enable_confirmations = true`). With it off, any typed address counts as verified and the public password sign-up endpoint hands out accounts with no email (audit 3 Oct 2026, F-01). Check after setting up an instance: a bare `signUp(email, password)` must return no session.
- New accounts start with both consents not granted; the app writes the fan's own name and answers only after the code is verified (F-02, migration 0013).

**Email delivery and captcha**

- Custom SMTP through Resend on the sending domain.
- Raise the Auth email rate limit for launch week.
- Captcha protection set to Turnstile, with the secret key in the dashboard.
- The site key goes in `VITE_TURNSTILE_SITE_KEY`.

## Repository map

```
src/                       the app (routes/, components/, i18n/strings.ts, config/, lib/api.ts)
supabase/migrations/       0001 privileges · 0002 tables · 0003 RLS · 0004 validation · 0005 fan RPCs
                           0006 settlement · 0007 ingest + operator · 0008 billing + opt-ins · 0009 cron
                           0010 exact-set flags · 0011 image bucket
supabase/events/           per event: the config file, and the draw file (players, bracket, start times, ids)
supabase/functions/poll-results/   the poller: index.ts (edge) · poll.ts · due.ts · adapters/ · fixtures/
supabase/tests/            SQL tests (rolled back) · _prelude.sql helpers
supabase/dev/              LOCAL ONLY: simulated clock, invented seed, PGlite shim
scripts/                   test-sql · simulate-event · run-advisors · dev-backend (+ console) · settle-benchmark
tests/                     bun tests + the shared set-score vectors
loadtest/                  k6-lock-rush.js · settle-100k.sql (staging only)
```

## Decisions taken in Phase 1, and what is still open

The approved plan lists the open questions in full.

- **Deciding set** (open question 1): Tino is asking the organiser. Only a full third set is implemented. Setting `rules.deciding_set` to anything else makes every pick and every result refuse (`deciding_set_mode_not_supported`) rather than guess.
- **Tiebreakers 3–5** (questions 2–4, decided by Tino on 1 Oct 2026):
  - The final-pick time is the last change to the pick on the final.
  - With no call on the final, the fan ranks after everyone who has one. If the final ended by retirement or walkover, the step is skipped for everyone.
  - The last resort is a **computer draw**. Each fan's draw number is `md5(tiebreak_seed || ':' || user_id)`.
  - The seed is random when the event is created, public (shown on How to play), and locked once the first match starts, so nobody can influence the draw and an audit can re-run it.
  - Publish the seed before the event: it is in `event_config.tiebreak_seed`.
- **A corrected result that changes a later match** (question 5): refill it and drop the picks naming the removed player if it has not started; pause it and alert if it has.
- **League owner deletes their account** (question 10): the longest-standing member becomes owner; an empty league is deleted.
- **Not yet decided: account deletion vs billing** (question 9). Deleting an account deletes its activity days, so a deleted fan no longer counts. A no-personal-data tombstone is ready to add if legal agrees.
- **Arabic:** wired (right-to-left layout, the switch, the flag) with no texts yet. They come with the reviewed translation in Phase 3.
- **Results source** (Tino, 1 Oct 2026): Wikipedia now, with the 10-minute stability rule; Sportradar added as a second source if a contract lands. The Wikipedia adapter is tested on the real 2024 and 2025 brackets (`tests/fixtures/wikipedia`, attributed excerpts) and end to end (`tests/wikipedia-replay.test.ts`).
- **How numbers show** (Tino, 2 Oct 2026): points are whole numbers everywhere (8, 14, "up to 28 pts"), as the rules round every score to a whole point. Calculated shares, such as "How fans picked", show one decimal (61.5%).
- **Sportradar adapter:** written from the documentation. It has not touched real data; Phase 3 checks it under a trial key.
