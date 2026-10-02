# Next steps

## Paused by Tino on 2 Oct 2026, to do after the UX/UI pass: finish Phase 2 (staging sign-in)

Staging is built (README, "Staging (Phase 2)"): https://preview.six-kings-game.pages.dev on Supabase project
`six-kings-game-staging` (`rmjlqqzytahmdlmnwxfc`, Frankfurt). Nobody can sign in yet: the free plan does
not allow the 6-digit code email with Supabase's built-in sender, so staging needs its own sender.

**Tino's three steps** (his accounts and secret keys):

1. **Resend:** sign up (free) at resend.com → *Domains → Add domain* `mail.grandslamgm.com`, EU region →
   connect Cloudflare so the DNS records are added → wait for **Verified** → *API Keys → Create*,
   **Sending access** for that domain → copy the key.
2. **Supabase SMTP:** dashboard → *six-kings-game-staging* → *Authentication → Emails → SMTP Settings* →
   enable custom SMTP: sender `no-reply@mail.grandslamgm.com`, name `Six Kings Slam Predictor`, host
   `smtp.resend.com`, port `465`, username `resend`, password = the Resend key → Save.
3. **The cron's key:** *Project Settings → API Keys → Legacy API keys* → copy **service_role** → *SQL Editor*:
   `select vault.create_secret('PASTE_KEY', 'service_role_key');`

**Then Claude:**

1. `bunx supabase config push --project-ref rmjlqqzytahmdlmnwxfc`: 6-digit codes (staging defaults to 8),
   10-minute expiry, the code-only email (`supabase/templates/code.html`), no confirmation email, site URL.
2. Check that the cron reaches the poller (`net._http_response` shows 200 within a minute).
3. Redeploy the app after the UX/UI changes (`bunx vite build --mode staging`, then
   `bunx wrangler pages deploy dist --project-name six-kings-game --branch preview`).
4. Tino signs in on the preview link with his own email: the code arrives from `mail.grandslamgm.com`.

Phase 2 is closed when step 4 works.

## Still open (not blocking)

- Deciding set: full set or 10-point match tiebreak (Tino is asking the organiser; the code accepts only
  a full set until then).
- Phase 3 extras chosen for later: Turnstile, a PostHog project, the ops alert channel.
- The 2026 Wikipedia article does not exist yet: set `WIKIPEDIA_PAGE` when it does.
