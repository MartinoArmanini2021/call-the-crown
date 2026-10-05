import { beforeEach, describe, expect, test } from "bun:test";
import { peekPendingJoin, setPendingJoin, takePendingJoin } from "../src/lib/leagueIntent";

// A sessionStorage stand-in (Bun has none).
class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
}

beforeEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
});

describe("pending invite code", () => {
  test("cleaned (case, spaces, dash), kept, used once", () => {
    setPendingJoin(" k7q-2px ");
    expect(peekPendingJoin()).toBe("K7Q2PX");
    expect(takePendingJoin()).toBe("K7Q2PX");
    expect(takePendingJoin()).toBeNull();
  });

  // full-debug F5: codes come from 2-9 and A-Z, so some are all digits. The router's search parser
  // hands "?join=234567" over as the number 234567; it must not crash the page.
  test("an all-digit code that arrives as a number is kept as text", () => {
    expect(() => setPendingJoin(234567 as unknown as string)).not.toThrow();
    expect(peekPendingJoin()).toBe("234567");
  });

  test("anything else that is not a code is ignored", () => {
    setPendingJoin(undefined as unknown as string);
    setPendingJoin({} as unknown as string);
    setPendingJoin("ABC");
    expect(peekPendingJoin()).toBeNull();
  });
});
