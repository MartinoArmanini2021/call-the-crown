# ATP Finals evening check — cloud routine (created 13 Nov 2026 on Tino's "Yes, create it")

- routine: The Final Prediction — ATP Finals evening check (22:30 Rome, 14–21 Nov)
- id: `trig_01Buh7GvCEMtqHKRS3y31WHP` · manage at https://claude.ai/code/routines/trig_01Buh7GvCEMtqHKRS3y31WHP
- schedule (UTC): `30 21 14-21 11 *` (22:30 Rome, Sat 14 to Sat 21 Nov) · first run Sat 14 Nov
- environment: env_011111111111111111111117 · model: claude-sonnet-5-5 · connectors: Gmail, Supabase
- what it does: reads tomorrow's official order of play, sets each match's pick-close time to its real
  start (`public.set_match_start`, the only write it may make, at most 4 a night, never within 60
  minutes of a lock), checks the results feed and alerts, and emails Tino one short status. The full
  prompt (with its safety limits) lives in the routine itself.

Without it: day-2/3 group matches and both semi-finals close at 14:00 Turin (the earliest possible
start), so a 20:30 match simply closes earlier than it could. Nothing is ever scored wrong: a pick saved
after a match really started scores 0 by the rules.
