import { describe, expect, test } from "bun:test";
import { initials, surname } from "../src/lib/format";

// Invented players (AGENTS.md).
describe("player names", () => {
  test("the scoreboard name keeps surname particles", () => {
    expect(surname("Ana de Vries")).toBe("de Vries");
    expect(surname("Tom Field")).toBe("Field");
    expect(surname("Ray")).toBe("Ray");
  });
  test("initials are first and last word", () => {
    expect(initials("Ana de Vries")).toBe("AV");
    expect(initials("Tom Field")).toBe("TF");
  });
});
