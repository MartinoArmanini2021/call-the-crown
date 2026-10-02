# Phase 3: launch build (live by Saturday 17 Oct 2026)

Started 2 Oct 2026 on Tino's "Go with Phase 3". His decisions that day:

- **Production database:** a new Supabase organisation on the Pro plan, separate from Astra LTD.
  Grand Slam GM stays on its free plan and the licence's costs are billed apart.
- **Region:** Frankfurt (eu-central-1), like staging.
- **Sign-in email sender:** `no-reply@mail.grandslamgm.com` through Resend, as on staging.
- **Ops alerts:** a Discord channel (webhook in Vault as `ops_webhook`; the watchdog already posts).
- **Points** stay whole numbers; calculated shares show one decimal.

## Done

- **Settlement under load, on staging (2 Oct):** 100,000 fans, one result, scored and fully re-ranked
  in **19.0 s** on the free plan's smallest server (limit 30 s). 100,000 strict ranks, everything
  rolled back afterwards (`loadtest/settle-100k.sql`).
- Real draw loaded on staging; organiser artwork request ready (`docs/organiser-player-assets.md`).
- **Arabic (2 Oct), draft for the organiser's review:** every text (`src/i18n/ar.ts`; a test refuses a
  missing text or a lost {placeholder}), player names in Arabic (draw file), Arabic twins for the
  event's own texts (`branding.*_ar`, `prizes[].title_ar`, `privacy.*_ar`), Arabic countdown units,
  right-to-left checked at phone size on landing and the draw. A phone set to Arabic opens in Arabic;
  the landing page has an "العربية / English" switch. On staging now (flags.arabic on).
- **The 2026 Wikipedia article does not exist yet** (checked 2 Oct); the poller points at it when it does.

## Tino

| By | What | Why |
|---|---|---|
| now | Create the organisation (suggested name "Six Kings Predictor") on **Pro** in the Supabase dashboard, payment included, then tell Claude | Claude creates the project in it; payment is yours to enter |
| now | Discord: a channel (e.g. `#six-kings-ops`) and a webhook. Paste it on **staging** first, SQL editor: `select vault.create_secret('<webhook url>', 'ops_webhook');` | Claude then fires a test alert to prove it |
| now | Cloudflare dashboard → Turnstile → add a widget for `preview.six-kings-game.pages.dev` (the organiser's subdomain is added later). Send Claude the **site key** (public). Paste the **secret key** in Supabase → Authentication → Attack protection (staging first) | The "I'm not a robot" check on sign-up |
| by 12 Oct | Resend: a plan that covers about 150,000 emails in October | Free = 100 a day; the sign-up rush needs thousands an hour |
| by 12 Oct | Send the organiser: the artwork request, and the asks below | |
| 12 Oct | Nothing: Claude loads the ATP ranking of Monday 12 Oct | Ranks lock at the first pick |

## The organiser (through Tino)

- Player artwork with usage rights (`docs/organiser-player-assets.md`).
- The official schedule (start time of each match).
- Deciding set: full third set or 10-point match tiebreak (the code accepts only a full set).
- Brand kit: logo (SVG), colours, fonts.
- Prize text, prize images, prize-terms URL.
- Sponsors for the four slots, with images, links and alt text (optional).
- The subdomain the game lives on, and a DNS record pointing it at Cloudflare Pages.
- Arabic review of the translated texts.
- Expected audience and peak, and the list of staff and test accounts to leave out of billing.
- Privacy notice and the two consent texts (or Tino's legal texts).

## Claude

| When | What |
|---|---|
| now | Production runbook and one-pass instance setup (migrations, event, draw, poller on Wikipedia, cron secrets) |
| when the org exists | Create `six-kings-game` (Frankfurt), set it up, advisors, end-to-end check with the fixture provider, then switch to Wikipedia |
| when keys arrive | Turnstile and alerts on staging, then production |
| 12 Oct | Load the ATP ranking of Monday 12 Oct (before any pick on production) |
| when the 2026 article exists | Point the poller at it and check the slot ids |
| when the subdomain arrives | Pages production branch on it, sign-in links, share images |
| ~15 Oct | Full rehearsal on staging; go/no-go note for Tino |
| 17 Oct | Launch on Tino's word |
