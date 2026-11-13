-- =====================================================================================================
-- 0060 - Italian as a fan language (13 Nov 2026: the ATP Finals in Turin, played by the owner's
-- friends). The app gains Italian behind event_config.flags.italian; a fan who picks it (or whose phone
-- is in Italian) keeps 'it' on their profile, so the reminder emails can speak Italian too.
-- As 0050 (handle_new_user) and 0051 (update_profile), with 'it' accepted next to 'en' and 'ar'.
-- Numbered 0060 to stay clear of other work in progress on 0055-0059.
-- =====================================================================================================

alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('en', 'ar', 'it'));

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
          case when v_meta->>'locale' in ('en', 'ar', 'it') then v_meta->>'locale' else 'en' end)
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

create or replace function public.update_profile(p_display_name text, p_locale text default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := public.clean_display_name(p_display_name);
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if v_name is null then
    if public.display_name_reserved(p_display_name) then raise exception 'display_name_reserved'; end if;
    raise exception 'display_name_length';
  end if;
  if p_locale is not null and p_locale not in ('en', 'ar', 'it') then raise exception 'bad_locale'; end if;
  update public.profiles
     set display_name = v_name, locale = coalesce(p_locale, locale)
   where user_id = v_uid;
end;
$$;
