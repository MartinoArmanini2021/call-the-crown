// After every `supabase db reset`: put back the two Vault secrets the cron jobs read (brief setup note 4).
//   bun tests/verify/lib/restore-vault.ts
import { SQL } from "bun";
import { $ } from "bun";

const status = JSON.parse(await $`bunx supabase status -o json`.quiet().text());
const sql = new SQL("postgresql://postgres:postgres@127.0.0.1:55322/postgres");
await sql`delete from vault.secrets where name in ('functions_url','service_role_key')`;
await sql`select vault.create_secret('http://host.docker.internal:55321/functions/v1', 'functions_url')`;
await sql`select vault.create_secret(${status.SERVICE_ROLE_KEY}, 'service_role_key')`;
console.log(await sql`select name from vault.decrypted_secrets order by name`);
await sql.close();
