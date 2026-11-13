# ATP Finals evening check — cloud routine (not created: the permission system blocked it on 13 Nov)

Create at https://claude.ai/code/routines (or ask Claude to create it, with your OK):
- name: Call the Crown — ATP Finals evening check (22:30 Rome, 14–21 Nov)
- schedule (UTC): `30 21 14-21 11 *`
- environment: env_011111111111111111111117 · model: claude-sonnet-5-5 · connectors: Gmail, Supabase
- what it does: reads tomorrow's official order of play, sets each match's pick-close time to its real
  start (`public.set_match_start`, the only write it may make, never within 60 minutes of a lock),
  checks the results feed and alerts, and emails you one short status. Full prompt: see the session of
  13 Nov 2026 (RemoteTrigger body), or ask Claude to recreate it from this note.

Without it: day-2/3 group matches and both semi-finals close at 14:00 Turin (the earliest possible
start), so a 20:30 match simply closes earlier than it could. Nothing is ever scored wrong: a pick saved
after a match really started scores 0 by the rules.
