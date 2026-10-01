// Client and server must agree on what a legal pick is. Every vector in tests/vectors/set-scores.json
// is checked against src/lib/validation.ts and against public.validate_set_scores in a throwaway
// database built from the real migrations.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import vectorsFile from "./vectors/set-scores.json";
import { validateSetScores, type ScoreRules } from "../src/lib/validation";
import { bootDb } from "../scripts/lib/db";

type Vector = {
  name: string;
  winner: number | null;
  sets: number | null;
  scores: (number | null)[][] | null;
  expect: string | null;
};

const rules = vectorsFile.rules as ScoreRules;
const vectors = vectorsFile.vectors as Vector[];
const toSets = (s: Vector["scores"]) =>
  s === null ? null : s.map(([a, b]) => ({ p1_games: a ?? undefined, p2_games: b ?? undefined }));

describe("client validation (src/lib/validation.ts)", () => {
  for (const v of vectors) {
    it(v.name, () => {
      expect(validateSetScores(rules, v.winner, v.sets, toSets(v.scores))).toBe(v.expect as never);
    });
  }

  it("refuses to guess when the deciding set is a match tiebreak (open question)", () => {
    expect(validateSetScores({ ...rules, deciding_set: "match_tiebreak" }, 1, 2, toSets([[6, 4], [6, 4]]))).toBe(
      "deciding_set_mode_not_supported",
    );
  });
});

describe("server validation (public.validate_set_scores) agrees", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootDb();
    // the vectors' rules must be the event's rules, or the comparison proves nothing
    const res = await db.query<{ rules: ScoreRules }>("select rules from public.event_config");
    expect(res.rows[0]?.rules.allowed_set_scores).toEqual(rules.allowed_set_scores);
    expect(res.rows[0]?.rules.deciding_set).toBe(rules.deciding_set);
  });
  afterAll(async () => {
    await db.close();
  });

  for (const v of vectors) {
    it(v.name, async () => {
      const scores = v.scores === null ? null : JSON.stringify(v.scores.map(([a, b]) => ({ p1_games: a, p2_games: b })));
      const res = await db.query<{ err: string | null }>(
        "select public.validate_set_scores($1::int, $2::int, $3::jsonb) as err",
        [v.winner, v.sets, scores],
      );
      expect(res.rows[0]?.err ?? null).toBe(v.expect);
    });
  }
});
