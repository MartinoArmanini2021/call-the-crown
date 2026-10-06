// Section L4 (clean_display_name) and L5 (delete_account, hand_over_leagues, ranks) on PGlite:
// migrations + sim clock + event + supabase/tests/_prelude.sql. Every test runs in begin … rollback.
//   bun test tests/verify/l/accounts.test.ts
// [BUG]/[SECURITY] tests FAIL today on purpose; [OK] tests pass; [SMELL] tests document behaviour.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb } from "../../../scripts/lib/db";

let db: PGlite;
beforeAll(async () => {
  db = await bootDb({ prelude: true });
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function q<T = Record<string, unknown>>(s: string, params?: unknown[]): Promise<T[]> {
  if (params) return (await db.query<T>(s, params)).rows;
  const r = await db.exec(s);
  return (r.at(-1)?.rows ?? []) as T[];
}
async function one<T = unknown>(s: string, params?: unknown[]): Promise<T> {
  const r = await q<Record<string, T>>(s, params);
  return Object.values(r[0] ?? { x: undefined })[0] as T;
}
async function inTx(fn: () => Promise<void>, setup = true) {
  await db.exec("begin");
  try {
    if (setup) await db.exec("select t.setup_event()");
    await fn();
  } finally {
    await db.exec("rollback");
  }
}
const clean = (s: string) => one<string | null>("select public.clean_display_name($1)", [s]);

// ---------------------------------------------------------------------------------------------------
// L4 clean_display_name
// ---------------------------------------------------------------------------------------------------
describe("L4 clean_display_name", () => {
  const cases: [string, string][] = [
    ["zero-width only (U+200B ×2)", "​​"],
    ["zero-width joiner inside", "Ad‍min"],
    ["word joiner / BOM only (U+2060 U+FEFF)", "⁠﻿"],
    ["RTL override U+202E", "‮nimda"],
    ["RTL override + PDF U+202C", "Fan ‮drowssap‬"],
    ["LRM/RLM U+200E U+200F", "‎‏"],
    ["isolates U+2066..2069", "⁧Fan⁩"],
    ["Arabic letter mark U+061C", "؜؜"],
    ["Hangul filler U+3164 ×2", "ㅤㅤ"],
    ["combining marks (Zalgo, 2 base + 20 marks)", "Z" + "̶͓́͜".repeat(5) + "a"],
    ["combining marks only (U+0301 ×3)", "́́́"],
    ["emoji", "👑 King"],
    ["emoji only (2)", "👑👑"],
    ["1 char", "A"],
    ["2 chars", "Ab"],
    ["24 chars", "x".repeat(24)],
    ["25 chars", "x".repeat(25)],
    ["26 chars", "x".repeat(26)],
    ["only spaces", "     "],
    ["only NBSP", "   "],
    ["tab/newline inside", "Fan\t\n Name"],
    ["control chars (U+0007)", "Fan\u0007\u0007"],
    ["Admin", "Admin"],
    ["Call the Crown", "Call the Crown"],
    ["call the crown", "call the crown"],
    ["homoglyph Cyrillic а/о", "Cаll the Crоwn"],
    ["fullwidth ＡＤＭＩＮ", "ＡＤＭＩＮ"],
    ["Organiser / Staff", "Staff"],
  ];

  test("[info] actual output for every input (printed)", async () => {
    const out: Record<string, string> = {};
    for (const [label, input] of cases) {
      const r = await clean(input);
      out[label] = r === null ? "NULL (refused)" : JSON.stringify(r) + ` (len ${[...r].length})`;
    }
    console.table(out);
  });

  test("[OK] length: 1, 25, 26 chars and only spaces are refused; 2 and 24 accepted", async () => {
    expect(await clean("A")).toBeNull();
    expect(await clean("x".repeat(25))).toBeNull();
    expect(await clean("x".repeat(26))).toBeNull();
    expect(await clean("     ")).toBeNull();
    expect(await clean("Ab")).toBe("Ab");
    expect(await clean("x".repeat(24))).toBe("x".repeat(24));
  });

  test("[BUG] an invisible name (zero-width / bidi / filler characters only) is refused", async () => {
    // FAILS today: \s does not cover U+200B, U+2060, U+FEFF, U+200E/F, U+061C, U+3164, so these pass
    // the 2–24 check and the board shows an empty-looking row.
    for (const s of ["​​", "⁠﻿", "‎‏", "؜؜", "ㅤㅤ"]) expect(await clean(s)).toBeNull();
  });

  test("[BUG] bidi controls (U+202A–202E, U+2066–2069) are refused or stripped", async () => {
    // FAILS today: "‮nimda" is stored and renders as "admin" mirrored; an override can also flip
    // the neighbouring columns of a board row.
    for (const s of ["‮nimda", "Fan ‮drowssap‬", "⁧Fan⁩"]) {
      const r = await clean(s);
      expect(r === null || !/[‪-‮⁦-⁩]/.test(r)).toBe(true);
    }
  });

  test("[BUG] stacked combining marks (Zalgo) are refused", async () => {
    // FAILS today: 2 base letters + 20 marks = 22 code points, inside 2–24, accepted.
    expect(await clean("Z" + "̶͓́͜".repeat(5) + "a")).toBeNull();
    expect(await clean("́́́")).toBeNull();
  });

  test("[BUG] C0 control characters are refused", async () => {
    // FAILS today: U+0007 is not \s and is kept.
    expect(await clean("Fan\u0007\u0007")).toBeNull();
  });

  test("[SMELL] names imitating staff are refused", async () => {
    // FAILS today (no reserved-name check at all). There is no staff badge in the UI, so a fan called
    // "Call the Crown" or "Admin" on the board is indistinguishable from the operator.
    for (const s of ["Admin", "Call the Crown", "call the crown", "Cаll the Crоwn", "ＡＤＭＩＮ"])
      expect(await clean(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// L5 delete_account
// ---------------------------------------------------------------------------------------------------
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** Fans 1..6, picks on QF1+QF2 so settlement gives 6 distinct ranks, QF1+QF2 settled. */
async function rankedEvent() {
  await db.exec(`
    select t.new_user(n) from generate_series(1, 6) n;
    select t.pick(t.uid(1), 1, 'c', '6-4 6-3');  select t.pick(t.uid(1), 2, 'd', '6-4 6-3');
    select t.pick(t.uid(2), 1, 'c', '6-4 6-3');  select t.pick(t.uid(2), 2, 'd', '6-2 6-2');
    select t.pick(t.uid(3), 1, 'c', '6-2 6-2');  select t.pick(t.uid(3), 2, 'e', '6-2 6-2');
    select t.pick(t.uid(4), 1, 'f', '6-2 6-2');  select t.pick(t.uid(4), 2, 'd', '6-2 6-2');
    select t.pick(t.uid(5), 1, 'f', '6-2 6-2');
    select public.dev_set_now('2026-10-21 20:00+00');
    select t.feed(1, 'completed', 'c', '6-4 6-3');
    select t.feed(2, 'completed', 'd', '6-4 6-3');
  `);
}
const ranks = () =>
  q<{ user_id: string; rank: number }>(
    "select user_id::text, rank from public.standings where rank is not null order by rank",
  );

async function asUser(n: number, s: string) {
  await db.exec(`select t.as_user(t.uid(${n}))`);
  try {
    return await q(s);
  } finally {
    await db.exec("select t.as_owner()");
  }
}

describe("L5 delete_account", () => {
  test("[OK] nothing about the user remains anywhere; leagues handed over / deleted; ranks dense", async () => {
    await inTx(async () => {
      await rankedEvent();
      const before = await ranks();
      expect(before.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      const victimRank = before.find((r) => r.user_id === U(2))!.rank;
      expect(victimRank).toBeGreaterThan(1);

      // Fan 2 owns "Shared" (members join order: 2, 4, 3) and "Solo"; is a member of fan 5's league;
      // was removed from fan 1's league (league_removals row); changed a consent.
      await asUser(
        2,
        "create temp table l_shared as select public.create_league('Shared') l; grant select on l_shared to public",
      );
      await asUser(
        2,
        "create temp table l_solo as select public.create_league('Solo') l; grant select on l_solo to public",
      );
      await asUser(
        5,
        "create temp table l_five as select public.create_league('Five') l; grant select on l_five to public",
      );
      await asUser(
        1,
        "create temp table l_one as select public.create_league('One') l; grant select on l_one to public",
      );
      await asUser(4, "select public.join_league((select l->>'code' from l_shared))");
      await asUser(3, "select public.join_league((select l->>'code' from l_shared))");
      await asUser(2, "select public.join_league((select l->>'code' from l_five))");
      await asUser(2, "select public.join_league((select l->>'code' from l_one))");
      await asUser(
        1,
        `select public.remove_member((select (l->>'id')::uuid from l_one), t.uid(2))`,
      );
      await asUser(2, "select public.update_consents(false, true, 'test-2')");

      // Inventory: every column in public whose type is uuid, plus all text/jsonb columns (ids in JSON).
      const cols = await q<{ t: string; c: string; ty: string }>(`
        select table_name t, column_name c, data_type ty from information_schema.columns
         where table_schema = 'public' and data_type in ('uuid', 'jsonb', 'json', 'text')
           and table_name in (select table_name from information_schema.tables
                               where table_schema = 'public' and table_type = 'BASE TABLE')`);
      const hits = async () => {
        const out: string[] = [];
        for (const { t, c } of cols) {
          const n = await one<number>(
            `select count(*)::int from public."${t}" where "${c}"::text like '%' || $1 || '%'`,
            [U(2)],
          );
          if (n > 0) out.push(`${t}.${c}=${n}`);
        }
        return out;
      };
      const pre = await hits();
      console.log("fan 2 appears before deletion in:", pre.join(", "));
      expect(pre.length).toBeGreaterThan(5);

      await asUser(2, "select public.delete_account()");

      expect(await hits()).toEqual([]);
      expect(await one<number>("select count(*)::int from auth.users where id = $1", [U(2)])).toBe(
        0,
      );

      // Shared → longest-standing other member (fan 4 joined before fan 3); Solo deleted.
      expect(
        await one<string>(
          "select owner_id::text from public.leagues where id = (select (l->>'id')::uuid from l_shared)",
        ),
      ).toBe(U(4));
      expect(
        await one<number>(
          "select count(*)::int from public.leagues where id = (select (l->>'id')::uuid from l_solo)",
        ),
      ).toBe(0);
      expect(
        await one<number>(
          "select count(*)::int from public.league_members where league_id = (select (l->>'id')::uuid from l_shared)",
        ),
      ).toBe(2);
      // fan 5's league and fan 1's league survive without fan 2
      expect(
        await one<number>(
          "select count(*)::int from public.leagues where id in ((select (l->>'id')::uuid from l_five), (select (l->>'id')::uuid from l_one))",
        ),
      ).toBe(2);

      // Ranks: dense 1..5, same order as before minus fan 2.
      const after = await ranks();
      expect(after.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(after.map((r) => r.user_id)).toEqual(
        before.filter((r) => r.user_id !== U(2)).map((r) => r.user_id),
      );
      // … and the board agrees: positions 1..5, total 5.
      const board = await asUser(1, "select pos, total from public.get_leaderboard(null, 0, 100)");
      expect(board.map((r) => (r as { pos: number }).pos)).toEqual([1, 2, 3, 4, 5]);

      // The next settlement ranks the same way (close_rank_gap and recompute_standings agree).
      await db.exec(
        `select public.dev_set_now('2026-10-22 20:30+00'); select t.feed(3, 'completed', 'a', '6-4 6-4');`,
      );
      expect((await ranks()).map((r) => r.user_id)).toEqual(after.map((r) => r.user_id));
    });
  });

  test("[OK F-12] an owner deleted outside delete_account (admin / dashboard) still hands the league over", async () => {
    await inTx(async () => {
      await db.exec("select t.new_user(n) from generate_series(41, 43) n");
      await asUser(
        41,
        "create temp table l41 as select public.create_league('Admin path') l; grant select on l41 to public",
      );
      await asUser(43, "select public.join_league((select l->>'code' from l41))");
      await asUser(42, "select public.join_league((select l->>'code' from l41))");
      await db.exec(`delete from auth.users where id = t.uid(41)`);
      expect(
        await one<string>(
          "select owner_id::text from public.leagues where id = (select (l->>'id')::uuid from l41)",
        ),
      ).toBe(U(43));
    });
  });

  test("[OK F-17] deleting the leader, a middle and the last fan keeps ranks dense", async () => {
    await inTx(async () => {
      await rankedEvent();
      const before = (await ranks()).map((r) => r.user_id);
      for (const victim of [before[0]!, before[3]!, before[5]!])
        await db.exec(`delete from auth.users where id = '${victim}'`);
      const after = await ranks();
      expect(after.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(after.map((r) => r.user_id)).toEqual([before[1], before[2], before[4]]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Unproven accounts on the board (follows from L1/L2: no server captcha + metadata name)
// ---------------------------------------------------------------------------------------------------
describe("unproven accounts", () => {
  test("[SECURITY, fixed by 0050] an account whose address was never proven is not listed or ranked on the board", async () => {
    await inTx(async () => {
      await rankedEvent();
      // A raw signUp after the first result: unconfirmed, confirmation mailed, name from the request.
      await db.exec(`insert into auth.users (id, email, encrypted_password, confirmation_sent_at, raw_user_meta_data)
                     values (t.uid(97), 'squat97@example.test', 'hash', now(), '{"display_name":"Call the Crown"}')`);
      const board = await asUser(
        1,
        "select pos, display_name, total from public.get_leaderboard(null, 0, 100)",
      );
      console.log("board after an unproven sign-up:", board);
      // FAILS today: rank_new_fan (0017) ranks it at once, recompute_standings (0006) ranks every
      // profile, and get_leaderboard lists it with the requested name; `total` counts it too.
      expect(
        board.some((r) => (r as { display_name: string }).display_name === "Call the Crown"),
      ).toBe(false);
    });
  });

  test("[fixed by 0050] an unproven sign-up is not counted in billing_report().registered", async () => {
    await inTx(async () => {
      await db.exec(
        `insert into auth.users (id, email, confirmation_sent_at) values (t.uid(98), 'squat98@example.test', now())`,
      );
      await db.exec("select t.as_service()");
      const r = await one<Record<string, number>>("select public.billing_report()");
      await db.exec("select t.as_owner()");
      console.log("billing_report with one unproven sign-up:", {
        registered: r["registered"],
        verified: r["verified"],
      });
      expect(r["registered"]).toBe(r["verified"]!);
    });
  });
});
