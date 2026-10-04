-- =====================================================================================================
-- 0013 — an address counts only once its owner has proven it (audit 3 Oct 2026, F-01 and F-02)
-- F-01: with email confirmations off, Auth marked every address "verified" at once, and its public
--       password sign-up endpoint handed out a signed-in account for any address. Confirmations are now
--       on (config.toml), and a password can never sit on an address nobody has proven: whoever calls
--       the sign-up endpoint with someone else's address gets an account that cannot sign in, and the
--       owner sets their own password after entering their code.
-- F-02: the name and the two consents used to come from the sign-up request, so the first person to
--       type an address decided them. New accounts now start with both consents NOT granted; the app
--       writes the fan's own name and answers right after the code is verified (update_profile,
--       update_consents), as the proven owner.
-- =====================================================================================================

-- A new account: profile, standings row, and both consents not granted, stamped with the version of the
-- privacy text the server publishes. Nothing personal is trusted from the request except a starting
-- display name and locale, which the verified owner overwrites straight away.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_version text  := coalesce((select privacy->>'version' from public.event_config), 'unknown');
begin
  insert into public.profiles (user_id, display_name, locale)
  values (new.id,
          public.clean_display_name(v_meta->>'display_name'),
          case when v_meta->>'locale' in ('en', 'ar') then v_meta->>'locale' else 'en' end)
  on conflict (user_id) do nothing;

  insert into public.standings (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.consents (user_id, party, granted, text_version) values
    (new.id, 'organiser', false, v_version),
    (new.id, 'gsgm',      false, v_version);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- No password on an address that has not been proven. Auth stores "no password" as an empty string.
-- Accounts created already confirmed (the Auth admin API, tests) keep theirs.
create function public.no_password_before_proof() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;
revoke all on function public.no_password_before_proof() from public, anon, authenticated;

create trigger no_password_before_proof before insert or update of encrypted_password, email_confirmed_at
  on auth.users for each row execute function public.no_password_before_proof();
