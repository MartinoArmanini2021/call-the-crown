// L5 / F-14 races on the REAL local Postgres (two connections, explicit interleaving).
//   L_LIVE=1 bun test tests/verify/l/races.test.ts
// Skipped unless L_LIVE=1. Creates only its own users (l-race-<run>-*@example.test, confirmed, no rank
// because the local standings are unranked or they are ranked last) and its own leagues; deletes them.
// lock_timeout 8s on every transaction so a wrong guess can never hang the shared stack.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000);
import type { SQL } from "bun";
import { LIVE, RUN, sleep, sql } from "./_live";

const email = (s: string, k: string) => `l-race${s}-${RUN}@example.test`.replace("@", `-${k}@`);

async function mkUser(s: string, k: string): Promise<string> {
  const [r] =
    await sql`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
                        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
                                'authenticated', ${email(s, k)}, now(), ${{ display_name: `Race ${k}` }})
                        returning id::text`;
  return r.id;
}
/** Owner O, members H (heir: joined first after O) and M. */
async function scenario(s: string) {
  const O = await mkUser(s, "owner");
  const H = await mkUser(s, "heir");
  const M = await mkUser(s, "third");
  const [l] =
    await sql`insert into public.leagues (name, code, owner_id) values (${`l-race-${RUN}-${s}`}, ${`LR${RUN}`.slice(0, 11).toUpperCase() + s.toUpperCase()}, ${O}) returning id::text`;
  await sql`insert into public.league_members (league_id, user_id, joined_at) values
            (${l.id}, ${O}, now() - interval '3 min'), (${l.id}, ${H}, now() - interval '2 min'), (${l.id}, ${M}, now() - interval '1 min')`;
  return { O, H, M, L: l.id as string };
}
async function tx(): Promise<SQL> {
  const c = await sql.reserve();
  await c`begin`;
  await c`set local lock_timeout = '8s'`;
  return c as unknown as SQL;
}
async function as(c: SQL, uid: string) {
  await c.unsafe(`set local role authenticated`);
  await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
}
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e.message,
  );
async function state(L: string) {
  const [lg] = await sql`select owner_id::text from public.leagues where id = ${L}`;
  const mem = await sql`select user_id::text from public.league_members where league_id = ${L}`;
  return {
    owner: (lg?.owner_id as string | undefined) ?? null,
    members: mem.map((r: { user_id: string }) => r.user_id),
  };
}

describe.if(LIVE)("L5 hand-over races (real Postgres, two connections)", () => {
  afterAll(async () => {
    await sql`delete from public.leagues where name like ${`l-race-${RUN}-%`}`;
    await sql`delete from auth.users where email like ${`l-race%-${RUN}-%@example.test`}`;
  });

  test("[OK F-14] owner deletes first, heir leaves meanwhile → heir is told owner_cannot_leave and owns it", async () => {
    const { O, H, L } = await scenario("a");
    const t1 = await tx();
    const t2 = await tx();
    try {
      await as(t1, O);
      await t1`select public.delete_account()`;
      await as(t2, H);
      const leave = err(t2`select public.leave_league(${L}::uuid)`);
      await sleep(400);
      await t1`commit`;
      const e = await leave;
      await t2`rollback`;
      expect(e).toMatch(/owner_cannot_leave/);
      const s = await state(L);
      expect(s.owner).toBe(H);
      expect(s.members).toContain(H);
    } finally {
      (t1 as unknown as { release(): void }).release();
      (t2 as unknown as { release(): void }).release();
    }
  });

  test("[OK F-14] heir leaves first, owner deletes meanwhile → the third member inherits", async () => {
    const { O, H, M, L } = await scenario("b");
    const t1 = await tx();
    const t2 = await tx();
    try {
      await as(t2, H);
      await t2`select public.leave_league(${L}::uuid)`;
      await as(t1, O);
      const del = err(t1`select public.delete_account()`);
      await sleep(400);
      await t2`commit`;
      expect(await del).toBeNull();
      await t1`commit`;
      const s = await state(L);
      expect(s.owner).toBe(M);
      expect(s.members).toEqual([M]);
    } finally {
      (t1 as unknown as { release(): void }).release();
      (t2 as unknown as { release(): void }).release();
    }
  });

  test("[OK] owner deletes first, heir deletes their account meanwhile → the third member inherits", async () => {
    const { O, H, M, L } = await scenario("c");
    const t1 = await tx();
    const t2 = await tx();
    try {
      await as(t1, O);
      await t1`select public.delete_account()`;
      await as(t2, H);
      const del2 = err(t2`select public.delete_account()`);
      await sleep(400);
      await t1`commit`;
      expect(await del2).toBeNull();
      await t2`commit`;
      const s = await state(L);
      expect(s.owner).toBe(M);
    } finally {
      (t1 as unknown as { release(): void }).release();
      (t2 as unknown as { release(): void }).release();
    }
  });

  test("[SMELL] heir deletes first, owner deletes meanwhile → the owner's deletion should still succeed", async () => {
    // Expected to FAIL today: hand_over_leagues picks the heir from a snapshot in which the heir's
    // membership still exists (the heir's transaction has not committed), then the FK check on
    // leagues.owner_id waits for the heir's auth.users row and finds it gone: the owner's
    // delete_account() raises a foreign-key error (the app shows err_generic; a retry works).
    const { O, H, M, L } = await scenario("d");
    const t1 = await tx();
    const t2 = await tx();
    try {
      await as(t2, H);
      await t2`select public.delete_account()`;
      await as(t1, O);
      const del1 = err(t1`select public.delete_account()`);
      await sleep(400);
      await t2`commit`;
      const e = await del1;
      console.log("owner's delete_account while the heir deletes →", e ?? "ok");
      if (e) await t1`rollback`;
      else await t1`commit`;
      const s = await state(L);
      console.log("league after:", s, { O, H, M });
      expect(e).toBeNull();
    } finally {
      (t1 as unknown as { release(): void }).release();
      (t2 as unknown as { release(): void }).release();
    }
  });
});
