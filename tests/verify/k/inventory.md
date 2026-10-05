# K1 inventory: schema public on the local stack

Generated 2026-10-05T20:56:28.392Z by tests/verify/k/inventory.ts (read-only catalog queries).

## Relations (tables, views, sequences) with RLS flags and owner

| name | kind | owner | rls | force_rls | options | acl |
| --- | --- | --- | --- | --- | --- | --- |
| billing_snapshots_id_seq | sequence | postgres | false | false |  | (default) |
| ops_alerts_id_seq | sequence | postgres | false | false |  | (default) |
| result_log_id_seq | sequence | postgres | false | false |  | (default) |
| activity_days | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |
| billing_snapshots | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |
| consents | table | postgres | true | false |  | postgres=arwdDxtm/postgres authenticated=r/postgres service_role=r/postgres |
| dev_clock | table | postgres | true | false |  | postgres=arwdDxtm/postgres |
| event_config | table | postgres | true | false |  | postgres=arwdDxtm/postgres anon=r/postgres authenticated=r/postgres service_role=arwd/postgres |
| league_members | table | postgres | true | false |  | postgres=arwdDxtm/postgres authenticated=r/postgres service_role=r/postgres |
| league_removals | table | postgres | true | false |  | postgres=arwdDxtm/postgres |
| leagues | table | postgres | true | false |  | postgres=arwdDxtm/postgres authenticated=r/postgres service_role=r/postgres |
| match_crowd | table | postgres | true | false |  | postgres=arwdDxtm/postgres |
| matches | table | postgres | true | false |  | postgres=arwdDxtm/postgres anon=r/postgres authenticated=r/postgres service_role=r/postgres |
| ops_alerts | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |
| ops_health | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |
| picks | table | postgres | true | false |  | postgres=arwdDxtm/postgres authenticated=r/postgres service_role=r/postgres |
| players | table | postgres | true | false |  | postgres=arwdDxtm/postgres anon=r/postgres authenticated=r/postgres service_role=r/postgres |
| profiles | table | postgres | true | false |  | postgres=arwdDxtm/postgres authenticated=r/postgres service_role=r/postgres |
| provider_map | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=arwd/postgres |
| result_log | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |
| standings | table | postgres | true | false |  | postgres=arwdDxtm/postgres service_role=r/postgres |

## Table privileges for anon / authenticated / service_role / PUBLIC (information_schema)

| table_name | grantee | privileges |
| --- | --- | --- |
| activity_days | service_role | SELECT |
| billing_snapshots | service_role | SELECT |
| consents | authenticated | SELECT |
| consents | service_role | SELECT |
| event_config | anon | SELECT |
| event_config | authenticated | SELECT |
| event_config | service_role | DELETE,INSERT,SELECT,UPDATE |
| league_members | authenticated | SELECT |
| league_members | service_role | SELECT |
| leagues | authenticated | SELECT |
| leagues | service_role | SELECT |
| matches | anon | SELECT |
| matches | authenticated | SELECT |
| matches | service_role | SELECT |
| ops_alerts | service_role | SELECT |
| ops_health | service_role | SELECT |
| picks | authenticated | SELECT |
| picks | service_role | SELECT |
| players | anon | SELECT |
| players | authenticated | SELECT |
| players | service_role | SELECT |
| profiles | authenticated | SELECT |
| profiles | service_role | SELECT |
| provider_map | service_role | DELETE,INSERT,SELECT,UPDATE |
| result_log | service_role | SELECT |
| standings | service_role | SELECT |

## Column-level privileges (where narrower than table)

| table_name | column_name | grantee | privileges |
| --- | --- | --- | --- |
| profiles | is_staff | service_role | UPDATE |
| profiles | is_test | service_role | UPDATE |

## Sequence privileges

| sequence | grantee | usage | select | update |
| --- | --- | --- | --- | --- |
| billing_snapshots_id_seq | anon | false | false | false |
| billing_snapshots_id_seq | authenticated | false | false | false |
| billing_snapshots_id_seq | service_role | false | false | false |
| ops_alerts_id_seq | anon | false | false | false |
| ops_alerts_id_seq | authenticated | false | false | false |
| ops_alerts_id_seq | service_role | false | false | false |
| result_log_id_seq | anon | false | false | false |
| result_log_id_seq | authenticated | false | false | false |
| result_log_id_seq | service_role | false | false | false |

## Views (security_invoker, updatable)

_(none)_

## Policies

| tablename | policyname | permissive | roles | cmd | using_expr | with_check |
| --- | --- | --- | --- | --- | --- | --- |
| consents | consents: own rows | PERMISSIVE | authenticated | SELECT | (user_id = ( SELECT auth.uid() AS uid)) |  |
| event_config | event config is public | PERMISSIVE | anon,authenticated | SELECT | true |  |
| league_members | league members: of my leagues | PERMISSIVE | authenticated | SELECT | (league_id IN ( SELECT my_league_ids() AS my_league_ids)) |  |
| leagues | leagues: mine | PERMISSIVE | authenticated | SELECT | (id IN ( SELECT my_league_ids() AS my_league_ids)) |  |
| matches | matches are public | PERMISSIVE | anon,authenticated | SELECT | true |  |
| picks | picks: own, or the match has started | PERMISSIVE | authenticated | SELECT | ((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM matches m   WHERE ((m.match_no = picks.match_no) AND (m.starts_at IS NOT NULL) AND (m.starts_at <= app_now()))))) |  |
| players | players are public | PERMISSIVE | anon,authenticated | SELECT | true |  |
| profiles | profiles: own row | PERMISSIVE | authenticated | SELECT | (user_id = ( SELECT auth.uid() AS uid)) |  |

## Functions (owner, security, search_path, EXECUTE for anon/authenticated/service_role/PUBLIC)

| function | owner | security | config | vol | anon | authn | service | acl |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| advance_bracket(p_match integer) | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| app_now() | postgres | DEFINER | search_path=public | s | true | true | true | postgres=X/postgres anon=X/postgres authenticated=X/postgres service_role=X/postgres |
| assert_board_access(p_league uuid) | postgres | DEFINER | search_path=public | s | false | false | false | postgres=X/postgres |
| billing_report() | postgres | DEFINER | search_path=public | s | false | false | true | postgres=X/postgres service_role=X/postgres |
| board_rows(p_league uuid) | postgres | DEFINER | search_path=public | s | false | false | false | postgres=X/postgres |
| canonical_set_scores(p_scores jsonb) | postgres | invoker | search_path=public | i | false | false | false | postgres=X/postgres |
| clean_display_name(p_name text) | postgres | invoker | search_path=public | i | false | false | false | postgres=X/postgres |
| close_rank_gap() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| create_league(p_name text) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| delete_account() | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| delete_league(p_league uuid) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| dev_set_now(p_at timestamp with time zone) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| export_optins(p_party text) | postgres | DEFINER | search_path=public | s | false | false | true | postgres=X/postgres service_role=X/postgres |
| gen_league_code() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| get_leaderboard(p_league uuid, p_offset integer, p_limit integer) | postgres | DEFINER | search_path=public | s | false | true | false | postgres=X/postgres authenticated=X/postgres |
| get_league_picks(p_league uuid, p_match integer) | postgres | DEFINER | search_path=public | s | false | true | false | postgres=X/postgres authenticated=X/postgres |
| get_match_crowd(p_match integer) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| get_rank_window(p_league uuid, p_radius integer) | postgres | DEFINER | search_path=public | s | false | true | false | postgres=X/postgres authenticated=X/postgres |
| guard_match_result() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| guard_settlement_only() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| guard_tiebreak_seed() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| hand_over_leagues() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| handle_new_user() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| ingest_heartbeat(p_ok boolean, p_detail text) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| ingest_result(p_provider text, p_normalised jsonb, p_raw jsonb, p_http_status integer) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| is_complete_set(a integer, b integer) | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |
| join_league(p_code text) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| kick_poller() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| leave_league(p_league uuid) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| lock_match_now(p_match integer) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| my_league_ids() | postgres | DEFINER | search_path=public | s | false | true | false | postgres=X/postgres authenticated=X/postgres |
| my_leagues() | postgres | DEFINER | search_path=public | s | false | true | false | postgres=X/postgres authenticated=X/postgres |
| no_password_before_proof() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| orient_set_scores(p_scores jsonb, p_flip boolean) | postgres | invoker | search_path=public | i | false | false | false | postgres=X/postgres |
| pause_settlement(p_match integer, p_paused boolean) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| rank_new_fan() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| real_start(p_match integer) | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |
| recompute_standings() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| refresh_match_points(p_match integer) | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| remove_member(p_league uuid, p_user uuid) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| request_refetch(p_match integer) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| reseat_paused_match(p_match integer) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| result_log_immutable() | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| save_pick(p_match integer, p_winner text, p_sets integer, p_set_scores jsonb) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| score_match(p_match integer) | postgres | invoker | search_path=public | v | false | false | false | postgres=X/postgres |
| set_match_start(p_match integer, p_starts_at timestamp with time zone) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| set_players(p_players jsonb, p_matches jsonb) | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| settle_match(p_match integer, p_status text, p_winner text, p_set_scores jsonb) | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| settling() | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |
| snapshot_billing() | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| update_consents(p_organiser boolean, p_gsgm boolean, p_text_version text) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| update_profile(p_display_name text, p_locale text) | postgres | DEFINER | search_path=public | v | false | true | false | postgres=X/postgres authenticated=X/postgres |
| validate_retirement(p_winner integer, p_scores jsonb) | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |
| validate_set_scores(p_winner_slot integer, p_sets integer, p_scores jsonb) | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |
| watchdog() | postgres | DEFINER | search_path=public | v | false | false | false | postgres=X/postgres |
| watchdog_check() | postgres | DEFINER | search_path=public | v | false | false | true | postgres=X/postgres service_role=X/postgres |
| win_points(p_round text, p_rank integer, p_opp_rank integer) | postgres | invoker | search_path=public | s | false | false | false | postgres=X/postgres |

## Triggers (public tables, and public functions fired from other schemas)

| on_table | trigger | function | fn_security | definition |
| --- | --- | --- | --- | --- |
| auth.users | hand_over_leagues | public.hand_over_leagues | DEFINER | CREATE TRIGGER hand_over_leagues BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION hand_over_leagues() |
| auth.users | no_password_before_proof | public.no_password_before_proof | DEFINER | CREATE TRIGGER no_password_before_proof BEFORE UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION no_password_before_proof() |
| auth.users | on_auth_user_created | public.handle_new_user | DEFINER | CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user() |
| public.event_config | event_config_seed_guard | public.guard_tiebreak_seed | invoker | CREATE TRIGGER event_config_seed_guard BEFORE UPDATE ON public.event_config FOR EACH ROW EXECUTE FUNCTION guard_tiebreak_seed() |
| public.matches | matches_result_guard | public.guard_match_result | invoker | CREATE TRIGGER matches_result_guard BEFORE INSERT OR DELETE OR UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION guard_match_result() |
| public.picks | picks_score_guard | public.guard_settlement_only | invoker | CREATE TRIGGER picks_score_guard BEFORE UPDATE ON public.picks FOR EACH ROW WHEN (((((((((old.pts_winner IS DISTINCT FROM new.pts_winner) OR (old.pts_sets IS DISTINCT FROM new.pts_sets)) OR (old.pts_exact IS DISTINCT FROM new.pts_exact)) OR (old.exact_sets IS DISTINCT FROM new.exact_sets)) OR (old.pts_total IS DISTINCT FROM new.pts_total)) OR (old.scored_rev IS DISTINCT FROM new.scored_rev)) OR (old.exact_flags IS DISTINCT FROM new.exact_flags)) AND (current_setting('skg.settling'::text, true) IS DISTINCT FROM '1'::text))) EXECUTE FUNCTION guard_settlement_only() |
| public.result_log | result_log_no_change | public.result_log_immutable | invoker | CREATE TRIGGER result_log_no_change BEFORE DELETE OR UPDATE ON public.result_log FOR EACH ROW EXECUTE FUNCTION result_log_immutable() |
| public.result_log | result_log_no_truncate | public.result_log_immutable | invoker | CREATE TRIGGER result_log_no_truncate BEFORE TRUNCATE ON public.result_log FOR EACH STATEMENT EXECUTE FUNCTION result_log_immutable() |
| public.standings | standings_close_rank_gap | public.close_rank_gap | DEFINER | CREATE TRIGGER standings_close_rank_gap AFTER DELETE ON public.standings FOR EACH ROW WHEN ((old.rank IS NOT NULL)) EXECUTE FUNCTION close_rank_gap() |
| public.standings | standings_rank_new_fan | public.rank_new_fan | DEFINER | CREATE TRIGGER standings_rank_new_fan AFTER INSERT ON public.standings FOR EACH ROW EXECUTE FUNCTION rank_new_fan() |
| public.standings | standings_score_guard | public.guard_settlement_only | invoker | CREATE TRIGGER standings_score_guard BEFORE UPDATE ON public.standings FOR EACH ROW WHEN (((((((old.points IS DISTINCT FROM new.points) OR (old.exact_sets IS DISTINCT FROM new.exact_sets)) OR (old.final_games_gap IS DISTINCT FROM new.final_games_gap)) OR (old.final_pick_at IS DISTINCT FROM new.final_pick_at)) OR (old.rank IS DISTINCT FROM new.rank)) AND (current_setting('skg.settling'::text, true) IS DISTINCT FROM '1'::text))) EXECUTE FUNCTION guard_settlement_only() |

## Default privileges (pg_default_acl), all schemas

| for_role | schema | objects | acl |
| --- | --- | --- | --- |
| postgres | (global) | functions | postgres=X/postgres |
| postgres | public | functions | postgres=X/postgres |
| postgres | public | sequences | postgres=rwU/postgres |
| postgres | public | tables | postgres=arwdDxtm/postgres |
| postgres | storage | functions | postgres=X/postgres anon=X/postgres authenticated=X/postgres service_role=X/postgres |
| postgres | storage | sequences | postgres=rwU/postgres anon=rwU/postgres authenticated=rwU/postgres service_role=rwU/postgres |
| postgres | storage | tables | postgres=arwdDxtm/postgres anon=arwdDxtm/postgres authenticated=arwdDxtm/postgres service_role=arwdDxtm/postgres |
| supabase_admin | cron | functions | postgres=X*/supabase_admin |
| supabase_admin | cron | sequences | postgres=r*w*U*/supabase_admin |
| supabase_admin | cron | tables | postgres=a*r*w*d*D*x*t*m*/supabase_admin |
| supabase_admin | extensions | functions | postgres=X*/supabase_admin |
| supabase_admin | extensions | sequences | postgres=r*w*U*/supabase_admin |
| supabase_admin | extensions | tables | postgres=a*r*w*d*D*x*t*m*/supabase_admin |
| supabase_admin | graphql | functions | postgres=X/supabase_admin anon=X/supabase_admin authenticated=X/supabase_admin service_role=X/supabase_admin |
| supabase_admin | graphql | sequences | postgres=rwU/supabase_admin anon=rwU/supabase_admin authenticated=rwU/supabase_admin service_role=rwU/supabase_admin |
| supabase_admin | graphql | tables | postgres=arwdDxtm/supabase_admin anon=arwdDxtm/supabase_admin authenticated=arwdDxtm/supabase_admin service_role=arwdDxtm/supabase_admin |
| supabase_admin | graphql_public | functions | postgres=X/supabase_admin anon=X/supabase_admin authenticated=X/supabase_admin service_role=X/supabase_admin |
| supabase_admin | graphql_public | sequences | postgres=rwU/supabase_admin anon=rwU/supabase_admin authenticated=rwU/supabase_admin service_role=rwU/supabase_admin |
| supabase_admin | graphql_public | tables | postgres=arwdDxtm/supabase_admin anon=arwdDxtm/supabase_admin authenticated=arwdDxtm/supabase_admin service_role=arwdDxtm/supabase_admin |
| supabase_admin | public | functions | postgres=X/supabase_admin anon=X/supabase_admin authenticated=X/supabase_admin service_role=X/supabase_admin |
| supabase_admin | public | sequences | postgres=rwU/supabase_admin anon=rwU/supabase_admin authenticated=rwU/supabase_admin service_role=rwU/supabase_admin |
| supabase_admin | public | tables | postgres=arwdDxtm/supabase_admin anon=arwdDxtm/supabase_admin authenticated=arwdDxtm/supabase_admin service_role=arwdDxtm/supabase_admin |
| supabase_admin | realtime | functions | postgres=X/supabase_admin dashboard_user=X/supabase_admin |
| supabase_admin | realtime | sequences | postgres=rwU/supabase_admin dashboard_user=rwU/supabase_admin |
| supabase_admin | realtime | tables | postgres=arwdDxtm/supabase_admin dashboard_user=arwdDxtm/supabase_admin |
| supabase_admin | supabase_functions | functions | postgres=X/supabase_admin anon=X/supabase_admin authenticated=X/supabase_admin service_role=X/supabase_admin |
| supabase_admin | supabase_functions | sequences | postgres=rwU/supabase_admin anon=rwU/supabase_admin authenticated=rwU/supabase_admin service_role=rwU/supabase_admin |
| supabase_admin | supabase_functions | tables | postgres=arwdDxtm/supabase_admin anon=arwdDxtm/supabase_admin authenticated=arwdDxtm/supabase_admin service_role=arwdDxtm/supabase_admin |
| supabase_auth_admin | auth | functions | postgres=X/supabase_auth_admin dashboard_user=X/supabase_auth_admin |
| supabase_auth_admin | auth | sequences | postgres=rwU/supabase_auth_admin dashboard_user=rwU/supabase_auth_admin |
| supabase_auth_admin | auth | tables | postgres=arwdDxtm/supabase_auth_admin dashboard_user=arwdDxtm/supabase_auth_admin |

## Schema privileges

| schema | role | usage | create |
| --- | --- | --- | --- |
| auth | anon | true | false |
| auth | authenticated | true | false |
| auth | service_role | true | false |
| cron | anon | false | false |
| cron | authenticated | false | false |
| cron | service_role | false | false |
| extensions | anon | true | false |
| extensions | authenticated | true | false |
| extensions | service_role | true | false |
| graphql_public | anon | true | false |
| graphql_public | authenticated | true | false |
| graphql_public | service_role | true | false |
| net | anon | true | false |
| net | authenticated | true | false |
| net | service_role | true | false |
| public | anon | true | false |
| public | authenticated | true | false |
| public | service_role | true | false |
| storage | anon | true | false |
| storage | authenticated | true | false |
| storage | service_role | true | false |
| vault | anon | false | false |
| vault | authenticated | false | false |
| vault | service_role | true | false |

## Roles that matter

| rolname | rolsuper | rolbypassrls | rolinherit | rolcanlogin |
| --- | --- | --- | --- | --- |
| anon | false | false | true | false |
| authenticated | false | false | true | false |
| authenticator | false | false | false | true |
| postgres | false | true | true | true |
| service_role | false | true | true | false |
| supabase_admin | true | true | true | true |
| supabase_auth_admin | false | false | false | true |

## Exposed schemas (PostgREST db-schemas via authenticator role config)

| rolname | config |
| --- | --- |
| authenticator | session_preload_libraries=supautils, safeupdate ; statement_timeout=8s ; lock_timeout=8s |

## Cron jobs

| jobid | jobname | schedule | username | active | command |
| --- | --- | --- | --- | --- | --- |
| 1 | poll-results | * * * * * | postgres | true | select public.kick_poller(); |
| 2 | watchdog | */5 * * * * | postgres | true | select public.watchdog(); |
