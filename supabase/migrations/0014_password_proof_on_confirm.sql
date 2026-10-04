-- =====================================================================================================
-- 0014 — the "no password before proof" rule, moved to the moment of proof (fixes a regression in 0013)
-- 0013 wiped the password whenever an account row was written unconfirmed. Auth's admin API writes every
-- new account unconfirmed first and confirms it a moment later, so accounts created there (operator or
-- load-test accounts with a password) lost their password. Probed on the local stack, 4 Oct 2026:
-- an address proven by an emailed code always has confirmation_sent_at set; an admin-created account
-- never does.
-- The rule now: when an address is confirmed through an emailed code, any password set before that
-- moment is wiped (someone else may have typed it on the public sign-up endpoint); the owner chooses
-- their own right after (sign-in.tsx, password step). Admin-created accounts keep theirs. Until the
-- proof, Auth itself refuses a password sign-in on an unconfirmed address (enable_confirmations).
-- =====================================================================================================

drop trigger if exists no_password_before_proof on auth.users;

create or replace function public.no_password_before_proof() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and old.confirmation_sent_at is not null then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;
revoke all on function public.no_password_before_proof() from public, anon, authenticated;

create trigger no_password_before_proof before update of email_confirmed_at
  on auth.users for each row execute function public.no_password_before_proof();
