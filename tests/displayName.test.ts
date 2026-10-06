import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb } from "../scripts/lib/db";
import { reservedName } from "../src/lib/displayName";

// Names that imitate the game's own staff (Tino, 6 Oct 2026; migration 0051). The database decides;
// src/lib/displayName.ts mirrors it so Join can say so before the code is sent. Both must agree.
const C = String.fromCharCode;
const samples: [string, boolean][] = [
  ["Admin", true],
  ["ADMIN", true],
  ["A d m i n", true],
  ["Admin Tino", true],
  ["Tino Admin", true],
  ["4dm1n", true],
  [C(65313, 65316, 65325, 65321, 65326), true], // fullwidth ADMIN
  ["C" + C(1072) + "ll the Cr" + C(1086) + "wn", true], // Cyrillic a and o
  ["Call the Crown", true],
  ["Call The Crown HQ", true],
  ["Staff", true],
  ["Moderator", true],
  ["Support", true],
  ["Official Tips", true],
  ["Grand Slam GM", true],
  ["توقّع التاج", true],
  ["مشرف", true],
  ["الإدارة", true],
  ["Badminton Bob", false],
  ["Staffan", false],
  ["Crown Prince", false],
  ["Supporter 7", false],
  ["Mod Squad", false],
  ["Teamwork", false],
  ["José Núñez", false],
  ["مدير الكرة", false],
  ["محمد العتيبي", false],
  ["Fan One", false],
];

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("reserved display names", () => {
  test("the app refuses exactly what the database refuses", async () => {
    for (const [name, reserved] of samples) {
      const r = await db.query<{ r: boolean }>("select public.display_name_reserved($1) as r", [
        name,
      ]);
      expect(r.rows[0]!.r, `database: ${name}`).toBe(reserved);
      expect(reservedName(name), `app: ${name}`).toBe(reserved);
    }
  });
});
