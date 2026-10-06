# K2 access matrix: every public table × {anon, fan A, fan B} × {select, insert, update, delete, upsert, truncate}

Source runs:
- **Real local stack** (PostgREST + GoTrue + RLS, supabase-js): `bun tests/verify/k/access-matrix.ts`, raw output in `access-matrix.out.txt` / `access-matrix.json`. Two invented accounts (`k-a-…`, `k-b-…@example.test`) made through the Auth admin API and deleted afterwards. Setup: A picked QF1 and QF2, B picked QF1, A created a league, B joined it. Shared clock at the run: `app_now` = 2026-10-20 12:16 UTC, so **no match had started** (I may not move the clock).
- **Started-match state**: PGlite with real role switching (`set local role authenticated` + JWT claims, the same policy SQL): `tests/verify/k/k7-picks-leak.sql`, run by `bun test tests/verify/k/k.test.ts`.
- **TRUNCATE**: no PostgREST verb exists; tried by raw role switching on the real stack inside a rolled-back transaction (`lock_timeout 1s`).
- Update and delete were sent with a filter that matches nothing: a missing privilege still answers 42501, an allowed one changes nothing. Every "denied" below is `42501 permission denied for table …` (checked: the only refusal texts in the run).

Legend: **S** select · I insert · U update · D delete · Up upsert · T truncate. `—` = denied (42501).

| table | anon | fan A | fan B | reason for every allowed op |
| --- | --- | --- | --- | --- |
| activity_days | — | — | — | billing record; RPC-only (save_pick writes, billing_report reads) |
| billing_snapshots | — | — | — | operator only (snapshot_billing) |
| consents | — | **S** own 2 rows | **S** own 2 rows | the Account screen shows the fan's own consent state (`consentsQuery`); policy `user_id = auth.uid()` |
| dev_clock (local only) | — | — | — | simulated clock, local seed file only; not in migrations |
| event_config | **S** 1 row | **S** | **S** | public event data (rules, prizes, privacy text, tiebreak seed: public by design, 0002 comment) |
| league_members | — | **S** 2 rows (1 other) | **S** 2 rows (1 other) | members of leagues I belong to (policy via `my_league_ids()`). Not used by the client (it reads boards through RPCs); exposes co-members' `user_id` + `joined_at`. See SMELL K-S3 |
| league_removals | — | — | — | RPC-only (remove_member writes, join_league reads) |
| leagues | — | **S** 1 (own) | **S** 1 (A's) | leagues I belong to, incl. the join code (members share it). Not read directly by the client (uses `my_leagues`) |
| match_crowd | — | — | — | RPC-only (get_match_crowd) |
| matches | **S** 6 | **S** 6 | **S** 6 | public bracket and schedule (also exposes ops columns `settlement_paused`, `refetch_requested_at`, `started_at`: harmless) |
| ops_alerts | — | — | — | operator only |
| ops_health | — | — | — | operator only |
| picks | — | **S** own 2 | **S** own 1 | own picks (`myPicksQuery`). **Before a start, B saw 0 of A's picks (correct). After a start, every fan sees every fan's pick of that match: FINDING K-1** (proved on PGlite; the real stack had no started match) |
| players | **S** 6 | **S** 6 | **S** 6 | public player list |
| profiles | — | **S** own 1 | **S** own 1 | own name/locale (`profileQuery`); policy `user_id = auth.uid()` (also exposes own `is_staff`, `is_test`, `join_fail_*`: own row only) |
| provider_map | — | — | — | operator only |
| result_log | — | — | — | operator only (append-only trigger as well) |
| standings | — | — | — | boards only through RPCs |

**Insert, update, delete, upsert and truncate: denied for anon, A and B on every table** (54 table×caller cells × 5 write ops, all 42501). No allowed op lacks a reason, except the started-match picks read (K-1).

## Started match (PGlite, `k7-picks-leak.sql`, 3 fans, fan 3 in no league with anyone, QF1 started)

| check as fan 2 | today | with `proposed/k7-picks-own-rows.sql` |
| --- | --- | --- |
| `select … from picks where user_id = fan3` | **1 row** (winner, set scores, points, updated_at) | 0 |
| `select count(*) from picks where match_no = 1` | **3** (= every player of the match) | 1 (own) |
| own picks | 1 | 1 |
| `get_league_picks(league, 1)` | 2 (fans 1+2) | 2 |
| `get_match_crowd(1).picks` | 3 | 3 (by design on build/phase-1) |

## Other surfaces probed on the real stack
- **Storage bucket `event`** (public read): upload of a PNG by anon, A and B → `new row violates row-level security policy` (refused; the mime filter was bypassed by sending an allowed type, so the refusal is the policy, not the mime check).
- **GraphQL** `/graphql/v1` as anon → `PGRST106 Only the following schemas are exposed: public` (pg_graphql not exposed).
- **Functions**: anon can execute only `app_now`; a fan the 16 listed in `k3-lockin.sql` ("the exact set of functions a fan can execute").
