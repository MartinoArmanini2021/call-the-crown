-- =====================================================================================================
-- 0047 - the organiser opt-in is closed (audit 5-6 Oct 2026, Q3; decided by Tino on 6 Oct 2026: the app
-- runs standalone, there is no organiser list). The app already sends organiser = false on every save
-- (profile.tsx, sign-in.tsx); a raw RPC call could still record a new "yes" to that list. Now refused
-- with 'organiser_list_closed'. Earlier answers, the 'organiser' party and export_optins stay as they are
-- (nothing deleted). Only change against 0005: the refusal line. Grants as in 0005.
-- =====================================================================================================

create or replace function public.update_consents(p_organiser boolean, p_gsgm boolean, p_text_version text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_organiser is null or p_gsgm is null or coalesce(btrim(p_text_version), '') = '' then
    raise exception 'consent_incomplete';
  end if;
  if p_organiser then raise exception 'organiser_list_closed'; end if;
  for r in select * from (values ('organiser', p_organiser), ('gsgm', p_gsgm)) as v(party, granted) loop
    if r.granted is distinct from (
      select c.granted from public.consents c
       where c.user_id = v_uid and c.party = r.party order by c.changed_at desc limit 1
    ) then
      insert into public.consents (user_id, party, granted, text_version)
      values (v_uid, r.party, r.granted, btrim(p_text_version));
    end if;
  end loop;
end;
$$;
revoke all on function public.update_consents(boolean, boolean, text) from public, anon;
grant execute on function public.update_consents(boolean, boolean, text) to authenticated;
