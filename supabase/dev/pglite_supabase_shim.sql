-- =====================================================================================================
-- TEST ONLY — a minimal stand-in for the parts of Supabase the migrations rely on, so the SQL tests run
-- in-process (PGlite, via scripts/test-sql.ts) without Docker. A real `supabase start` already has all
-- of this and never loads this file.
--   roles anon / authenticated / service_role · auth.users · auth.uid() · vault.decrypted_secrets ·
--   cron.schedule() · net.http_post()
-- auth.uid() is the same expression Supabase uses: the JWT "sub" claim of the current request.
-- =====================================================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  encrypted_password varchar(255),
  raw_user_meta_data jsonb default '{}',
  created_at         timestamptz not null default now()
);
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint,
                              allowed_mime_types text[]);

create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql
as $$ insert into cron.job values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning 1::bigint $$;

create schema net;
create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', headers jsonb default '{}') returns bigint
language sql
as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id::bigint $$;

grant usage on schema public to anon, authenticated, service_role;
