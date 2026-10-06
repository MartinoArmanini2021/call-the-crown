import { describe, expect, test } from "bun:test";
import { initials, isolate, surname } from "../src/lib/format";

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

describe("isolate (full-debug E8)", () => {
  test("a fan's name is wrapped in FSI … PDI, so a bidi control inside cannot leak", () => {
    const hostile = "‮sec crew";
    const line = `${isolate(hostile)} needs 4 more members to enter.`;
    expect(line.startsWith("⁨‮sec crew⁩")).toBe(true);
    expect(isolate("دوري")).toBe("⁨دوري⁩");
  });
});

// Audit 5 Oct 2026, P4: a fan in Madrid or New York read "19:30" with nothing saying it was Riyadh time.
describe("match times say their time zone", () => {
  const qf1 = "2026-10-21T16:30:00Z"; // 19:30 in Riyadh
  test("English names the event's zone", async () => {
    const { localTime } = await import("../src/lib/format");
    const s = localTime(qf1, "Asia/Riyadh", "en");
    expect(s).toContain("19:30");
    expect(s).toMatch(/GMT\+3/);
  });
  test("Arabic names it too", async () => {
    const { localTime } = await import("../src/lib/format");
    const en = localTime(qf1, "Asia/Riyadh", "en");
    const ar = localTime(qf1, "Asia/Riyadh", "ar");
    const plain = new Intl.DateTimeFormat("ar", {
      timeZone: "Asia/Riyadh",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(qf1));
    expect(ar.length).toBeGreaterThan(plain.length);
    expect(ar).toMatch(/[+]3|٣/);
    expect(en).not.toBe(ar);
  });
  test("the zone follows the event, not the browser", async () => {
    const { localTime } = await import("../src/lib/format");
    expect(localTime(qf1, "Europe/Madrid", "en")).toMatch(/18:30 CEST|18:30 GMT\+2/);
  });
});
