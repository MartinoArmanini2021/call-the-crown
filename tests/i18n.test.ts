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
// bonus). Prize words are not checked here: whether the copy keeps prizes is Tino's decision.
describe("no betting words", () => {
  test("English copy", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      expect(en[key], key).not.toMatch(/wager|\bodds\b|\bstake\b|gambl|\bbets?\b|win more/i);
    }
  });
  test("Arabic copy", () => {
    for (const key of Object.keys(en) as StringKey[]) {
      expect(ar[key], key).not.toMatch(/راهن|رهان|مراهن|اربح/);
    }
  });
});
