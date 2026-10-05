# Audit reproductions, 5–6 Oct 2026 (Part 2 of docs/briefs/full-debug/brief.md)

Tests named `BUG`, `SECURITY` or `SMELL` **fail on purpose** until their finding is fixed or decided.
The gate (`bun test`) leaves this folder out (bunfig.toml); run a section by name:

| Section | Run | Needs |
|---|---|---|
| K database security | `bun test --path-ignore-patterns='' tests/verify/k` | PGlite; `access-matrix.ts`, `leagues-race.ts` need the local stack |
| L sign-in, accounts | `L_LIVE=1 bun test --path-ignore-patterns='' tests/verify/l` | local stack + Mailpit for the live half |
| M scoring + oracle | `bun test --path-ignore-patterns='' tests/verify/m` (`M_APPLY_PROPOSED=1` applies `proposed/m-*`) | PGlite, ~4 min |
| N locking, concurrency | `bun test --path-ignore-patterns='' tests/verify/n` | local Postgres (private throwaway database) |
| O results pipeline | `bun test --path-ignore-patterns='' tests/verify/o` | PGlite; `o4` needs the local stack |
| P front end | `PW=<dir with playwright-core> ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/<script>.ts` | app on :5182 |
| Q config, data | `bun test --path-ignore-patterns='' tests/verify/q` | PGlite |

- `oracle.ts` is the independent scorer (no app code imported).
- `proposed/` holds the Rule 4 patches: not applied, each waiting for Tino.
- `lib/restore-vault.ts` puts the two Vault secrets back after a `supabase db reset`.
- `screens/` are the P1 screenshots.
