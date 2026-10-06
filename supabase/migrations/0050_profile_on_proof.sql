-- =====================================================================================================
-- 0050 - nothing about an address exists in the game until it is proven (audit 5-6 Oct 2026, L1/L2;
-- decided by Tino on 6 Oct 2026).
-- The public sign-up endpoint let anyone create an account for any address with any name in its
-- metadata. handle_new_user (0013) turned that into a profile with the requested name, a standings row
-- ranked at once (0017/0025) and by every settlement, and a row in billing's "registered": an unproven
-- address showed on the global board under a name a stranger chose ("Call the Crown", "Admin", ...), and
-- the name survived the owner's proof on the Sign in path.
-- Now profile, standings row and consents are created when the address is proven (or when the account
-- is created already confirmed). A name from the request is kept only for accounts no code was ever
-- emailed to (operator/admin, the same test as 0014); a fan's own name comes from update_profile after
-- the code, as before. billing_report().registered now counts proven accounts only (Tino's OK, 6 Oct).
-- Changes against 0013: the early return, the name condition and the consent guard.
-- Existing unproven accounts lose their profile, standings row and consents; the statement-level
-- close_rank_gap (0049) closes the ranks behind them. They start again by entering a new code.
-- =====================================================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_version text  := coalesce((select privacy->>'version' from public.event_config), 'unknown');
begin
  if new.email_confirmed_at is null then return new; end if;   -- not proven: nothing yet

  insert into public.profiles (user_id, display_name, locale)
  values (new.id,
          case when new.confirmation_sent_at is null
               then public.clean_display_name(v_meta->>'display_name') end,
          case when v_meta->>'locale' in ('en', 'ar') then v_meta->>'locale' else 'en' end)
  on conflict (user_id) do nothing;

  insert into public.standings (user_id) values (new.id) on conflict (user_id) do nothing;

  if not exists (select 1 from public.consents where user_id = new.id) then
    insert into public.consents (user_id, party, granted, text_version) values
      (new.id, 'organiser', false, v_version),
      (new.id, 'gsgm',      false, v_version);
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_proven after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user();

-- Accounts already created and still unproven leave the board, billing and the consent tables.
-- (Their standings rows go first; close_rank_gap (0049) closes the ranks behind them.)
delete from public.standings s using auth.users u where u.id = s.user_id and u.email_confirmed_at is null;
delete from public.consents  c using auth.users u where u.id = c.user_id and u.email_confirmed_at is null;
delete from public.profiles  p using auth.users u where u.id = p.user_id and u.email_confirmed_at is null;
