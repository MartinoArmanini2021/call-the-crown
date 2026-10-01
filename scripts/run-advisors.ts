// The Supabase security advisor's ERROR-level checks, re-implemented as plain catalog queries and run
// against the real migrations in a throwaway database. Phase 1 has no Supabase project, so this is the
// local stand-in; Phase 2 runs the real advisors on staging (get_advisors) and must also show 0 ERROR.
// Lint names follow Supabase's (splinter) so the two reports line up.
//   bun run advisors
import { bootDb } from "./lib/db";

type Finding = { level: "ERROR" | "WARN"; lint: string; object: string };
const db = await bootDb();
const findings: Finding[] = [];
const add = (level: Finding["level"], lint: string, rows: { object: string }[]) =>
  rows.forEach((r) => findings.push({ level, lint, object: r.object }));
const q = async (sql: string) => (await db.query<{ object: string }>(sql)).rows;

// 0013 rls_disabled_in_public: a public table without RLS is readable and writable through the API.
add(
  "ERROR",
  "rls_disabled_in_public",
  await q(`
  select c.relname as object from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`),
);

// 0007 policy_exists_rls_disabled: policies that do nothing because RLS is off.
add(
  "ERROR",
  "policy_exists_rls_disabled",
  await q(`
  select distinct p.tablename as object from pg_policies p join pg_class c on c.relname = p.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
   where p.schemaname = 'public' and not c.relrowsecurity`),
);

// 0010 security_definer_view: a view that runs with its owner's rights (no security_invoker).
add(
  "ERROR",
  "security_definer_view",
  await q(`
  select c.relname as object from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)`),
);

// 0002 auth_users_exposed: a public view that reads auth.users.
add(
  "ERROR",
  "auth_users_exposed",
  await q(`
  select distinct v.relname as object from pg_depend d
    join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    join pg_namespace n on n.oid = v.relnamespace
   where n.nspname = 'public' and d.refobjid = 'auth.users'::regclass and v.relkind in ('v', 'm')`),
);

// 0015 rls_references_user_metadata: a policy trusting user-editable JWT metadata.
add(
  "ERROR",
  "rls_references_user_metadata",
  await q(`
  select tablename || '.' || policyname as object from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'user_metadata'`),
);

// 0011 function_search_path_mutable (WARN): a function whose search_path a caller could change.
add(
  "WARN",
  "function_search_path_mutable",
  await q(`
  select p.proname as object from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`),
);

// Our own rule (the brief): no table writable by anon or authenticated, no function executable by
// anon except the clock. Reported as ERROR because it is the security model.
add(
  "ERROR",
  "client_role_can_write_table",
  await q(`
  select c.relname || ' (' || r.rolname || ' ' || pr.p || ')' as object
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) r(rolname)
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, pr.p)`),
);
add(
  "ERROR",
  "anon_can_execute_function",
  await q(`
  select p.proname as object from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname <> 'app_now'`),
);

const errors = findings.filter((f) => f.level === "ERROR");
for (const f of findings) console.log(`${f.level.padEnd(5)}  ${f.lint}  ${f.object}`);
console.log(`\n${errors.length} ERROR, ${findings.length - errors.length} WARN`);
await db.close();
process.exit(errors.length === 0 ? 0 : 1);
