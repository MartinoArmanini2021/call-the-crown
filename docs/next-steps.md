# Next steps

## Phase 2: closed on 2 Oct 2026

Staging works end to end: https://preview.six-kings-game.pages.dev on Supabase project
`six-kings-game-staging` (`rmjlqqzytahmdlmnwxfc`, Frankfurt).

- Sign-in by 6-digit code, emailed through Resend from `no-reply@mail.grandslamgm.com`. Tino received a
  code and signed in.
- The cron reaches the poller every minute (HTTP 200, heartbeat healthy).
- The UX pass is live there (pick sheet, bracket, results, podium leaderboard, landing).
- Advisors: 0 ERROR.

How it was set up and how to redeploy: README, "Staging (Phase 2)".

## Phase 3: launch build (live by 17 Oct 2026)

Starts only on Tino's go. From the approved plan, what it needs:

**From the organiser**

- Brand kit (logo, colours, fonts) and the player photos with usage rights.
- Confirmed players, byes and the schedule.
- Prize text, prize images and the prize-terms URL.
- Sponsor slots and their assets (four placements: landing strip, leaderboard header, picks footer,
  results card).
- The subdomain the game lives on, and a DNS record pointing it at Cloudflare Pages.
- Arabic review of the translated texts.
- The expected audience and peak.
- The list of staff and test accounts to exclude from billing.

**From Tino**

- **Deciding set:** full set or 10-point match tiebreak (asked of the organiser; the code accepts only a
  full set until then).
- **Data residency:** sets the production Supabase region.
- **Production plan:** Supabase Pro for the event week, and a Resend tier sized for the sign-up rush
  (plan, section e).
- **Legal texts:** privacy notice and the two consents.
- **Extras chosen for Phase 3:** Turnstile, a PostHog project, the ops alert channel (Discord or Slack
  webhook).
- **Sign-in email sender:** confirm `mail.grandslamgm.com` for production too, or a neutral domain
  (fans should see only the organiser's brand).

**Claude**

- Production instance (new Supabase project, Pages production branch, subdomain) once approved.
- Organiser brand into `event_config`, player photos into storage.
- Arabic strings behind `flags.arabic`.
- Point the Wikipedia adapter at the 2026 article when it exists (`WIKIPEDIA_PAGE`); add Sportradar as a
  second source if a contract lands.
- Load test on staging (`loadtest/k6-lock-rush.js`, `loadtest/settle-100k.sql`).
