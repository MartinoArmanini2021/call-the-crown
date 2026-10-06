import { describe, expect, test } from "bun:test";
import { ar } from "../src/i18n/ar";
import { en, type StringKey } from "../src/i18n/strings";

const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Arabic texts", () => {
  test("every English key has a non-empty Arabic text", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      expect(ar[key]?.trim().length ?? 0, key).toBeGreaterThan(0);
    }
  });
  test("every {placeholder} is kept, and no new one appears", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      expect(holes(ar[key]), key).toEqual(holes(en[key]));
    }
  });
});

// A free game, not a bet: no betting words in either language (audit 5 Oct 2026, How to play upset
// bonus). The only allowed hit is the "no betting" fine print itself (brief H4). Prize words are not
// checked here.
const NO_BETTING_FINE_PRINT: StringKey[] = ["card_fine"];
describe("no betting words", () => {
  test("English copy", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      if (NO_BETTING_FINE_PRINT.includes(key)) continue;
      expect(en[key], key).not.toMatch(/wager|\bodds\b|\bstake\b|gambl|\bbets?\b|win more/i);
    }
  });
  test("Arabic copy", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      if (NO_BETTING_FINE_PRINT.includes(key)) continue;
      expect(ar[key], key).not.toMatch(/راهن|رهان|مراهن|اربح/);
    }
  });
  test("the fine print still says there is no betting", () => {
    expect(en.card_fine).toMatch(/no betting/i);
  });
});

// Decision 5 (Tino, 6 Oct 2026): a fan who joins after a result is listed last, and How to play says so.
describe("How to play: where a late joiner is listed", () => {
  test("the line exists in both languages and the page shows it", async () => {
    expect(en.htp_ties_late).toMatch(/bottom/i);
    expect(ar.htp_ties_late.trim().length).toBeGreaterThan(0);
    const page = await Bun.file(new URL("../src/routes/how-to-play.tsx", import.meta.url)).text();
    expect(page).toContain('t("htp_ties_late")');
  });
});
