// K1 inventory: read-only catalog dump of the local Supabase database (127.0.0.1:55322).
//   bun tests/verify/k/inventory.ts > tests/verify/k/inventory.md
// Only SELECTs against pg_catalog / information_schema. Never point at staging or production.
import { SQL } from "bun";

const url =
  process.env["TEST_DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!/@(127\.0\.0\.1|localhost):55322\//.test(url)) throw new Error("local stack only");
const sql = new SQL(url);

type Row = Record<string, unknown>;
function table(title: string, rows: Row[]) {
  console.log(`\n## ${title}\n`);
  if (rows.length === 0) {
    console.log("_(none)_");
    return;
  }
  const cols = Object.keys(rows[0]!);
  console.log(`| ${cols.join(" | ")} |`);
  console.log(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows)
    console.log(
      `| ${cols
        .map((c) =>
          String(r[c] ?? "")
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " "),
        )
        .join(" | ")} |`,
    );
}
const q = async (s: string) => (await sql.unsafe(s)) as Row[];

console.log("# K1 inventory: schema public on the local stack");
console.log(
  `\nGenerated ${new Date().toISOString()} by tests/verify/k/inventory.ts (read-only catalog queries).`,
);

table(
  "Relations (tables, views, sequences) with RLS flags and owner",
  await q(`
  select c.relname as name,
         case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview'
                        when 'S' then 'sequence' when 'p' then 'partitioned' else c.relkind::text end as kind,
         pg_get_userbyid(c.relowner) as owner,
         c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
         coalesce(array_to_string(c.reloptions, ','), '') as options,
         coalesce(array_to_string(c.relacl, ' '), '(default)') as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v','m','S','p')
   order by kind, name`),
);

table(
  "Table privileges for anon / authenticated / service_role / PUBLIC (information_schema)",
  await q(`
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC')
   group by table_name, grantee order by table_name, grantee`),
);

table(
  "Column-level privileges (where narrower than table)",
  await q(`
  select table_name, column_name, grantee, string_agg(privilege_type, ',') as privileges
    from information_schema.column_privileges cp
   where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC')
     and not exists (select 1 from information_schema.role_table_grants t
                      where t.table_schema = 'public' and t.table_name = cp.table_name
                        and t.grantee = cp.grantee and t.privilege_type = cp.privilege_type)
   group by table_name, column_name, grantee order by 1,2,3`),
);

table(
  "Sequence privileges",
  await q(`
  select c.relname as sequence, r.rolname as grantee,
         has_sequence_privilege(r.rolname, c.oid, 'USAGE') as usage,
         has_sequence_privilege(r.rolname, c.oid, 'SELECT') as select,
         has_sequence_privilege(r.rolname, c.oid, 'UPDATE') as update
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
   where n.nspname = 'public' and c.relkind = 'S' order by 1,2`),
);

table(
  "Views (security_invoker, updatable)",
  await q(`
  select c.relname as view, pg_get_userbyid(c.relowner) as owner,
         coalesce(array_to_string(c.reloptions, ','), '') as options,
         v.is_updatable, v.is_insertable_into, v.check_option
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join information_schema.views v on v.table_schema = n.nspname and v.table_name = c.relname
   where n.nspname = 'public' and c.relkind = 'v' order by 1`),
);

table(
  "Policies",
  await q(`
  select tablename, policyname, permissive, array_to_string(roles, ',') as roles, cmd,
         coalesce(qual, '') as using_expr, coalesce(with_check, '') as with_check
    from pg_policies where schemaname = 'public' order by tablename, policyname`),
);

table(
  "Functions (owner, security, search_path, EXECUTE for anon/authenticated/service_role/PUBLIC)",
  await q(`
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function,
         pg_get_userbyid(p.proowner) as owner,
         case when p.prosecdef then 'DEFINER' else 'invoker' end as security,
         coalesce(array_to_string(p.proconfig, ','), '(NOT PINNED)') as config,
         p.provolatile as vol,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
         coalesce(array_to_string(p.proacl, ' '), '(default: PUBLIC)') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p')
   order by p.proname`),
);

table(
  "Triggers (public tables, and public functions fired from other schemas)",
  await q(`
  select ns.nspname || '.' || c.relname as on_table, t.tgname as trigger,
         pn.nspname || '.' || p.proname as function,
         case when p.prosecdef then 'DEFINER' else 'invoker' end as fn_security,
         pg_get_triggerdef(t.oid) as definition
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
   where not t.tgisinternal and (ns.nspname = 'public' or pn.nspname = 'public')
   order by 1,2`),
);

table(
  "Default privileges (pg_default_acl), all schemas",
  await q(`
  select pg_get_userbyid(d.defaclrole) as for_role, coalesce(n.nspname, '(global)') as schema,
         case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
              when 'T' then 'types' when 'n' then 'schemas' end as objects,
         array_to_string(d.defaclacl, ' ') as acl
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
   order by 1,2,3`),
);

table(
  "Schema privileges",
  await q(`
  select n.nspname as schema, r.rolname as role,
         has_schema_privilege(r.rolname, n.oid, 'USAGE') as usage,
         has_schema_privilege(r.rolname, n.oid, 'CREATE') as create
    from pg_namespace n cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
   where n.nspname in ('public','auth','vault','cron','net','storage','graphql_public','extensions')
   order by 1,2`),
);

table(
  "Roles that matter",
  await q(`
  select rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin
    from pg_roles where rolname in ('postgres','anon','authenticated','service_role','authenticator',
                                     'supabase_admin','supabase_auth_admin') order by 1`),
);

table(
  "Exposed schemas (PostgREST db-schemas via authenticator role config)",
  await q(
    `select rolname, array_to_string(rolconfig, ' ; ') as config from pg_roles where rolname = 'authenticator'`,
  ),
);

table(
  "Cron jobs",
  await q(
    `select jobid, jobname, schedule, username, active, left(command, 120) as command from cron.job order by jobid`,
  ).catch(() => [] as Row[]),
);

await sql.close();
