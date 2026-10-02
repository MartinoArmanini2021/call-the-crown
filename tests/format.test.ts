import { describe, expect, test } from "bun:test";
import { initials, surname } from "../src/lib/format";

describe("player names", () => {
  test("the scoreboard name keeps surname particles", () => {
    expect(surname("Alex de Minaur")).toBe("de Minaur");
    expect(surname("Taylor Fritz")).toBe("Fritz");
    expect(surname("Sinner")).toBe("Sinner");
  });
  test("initials are first and last word", () => {
    expect(initials("Alex de Minaur")).toBe("AM");
    expect(initials("Novak Djokovic")).toBe("ND");
  });
});
