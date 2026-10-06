// Random generators for section M property tests (seeded; see harness.ts prng).
import { isLegalSet, type Rules, type Set, type Slot, type Status } from "../oracle";
import type { Rng } from "./harness";

export function legalSet(rules: Rules, rng: Rng, winner: Slot): Set {
  const [w, l] = rng.pick(rules.allowed_set_scores);
  return winner === 1 ? [w, l] : [l, w];
}
export function illegalSet(rules: Rules, rng: Rng): Set {
  for (;;) {
    const s: Set = [rng.int(0, 9), rng.int(0, 9)];
    if (!isLegalSet(rules, s)) return s;
  }
}
/** A legal match for winner `w` in `n` (2 or 3) sets. */
export function legalMatch(rules: Rules, rng: Rng, w: Slot, n: 2 | 3): Set[] {
  const l: Slot = w === 1 ? 2 : 1;
  if (n === 2) return [legalSet(rules, rng, w), legalSet(rules, rng, w)];
  const first: Slot = rng.chance(0.5) ? w : l;
  return [
    legalSet(rules, rng, first),
    legalSet(rules, rng, first === w ? l : w),
    legalSet(rules, rng, w),
  ];
}
/** Any 2-element set, legal or not, any winner. */
export function anySet(rules: Rules, rng: Rng): Set {
  return rng.chance(0.75)
    ? legalSet(rules, rng, rng.pick([1, 2] as const))
    : illegalSet(rules, rng);
}

/** A fan's raw input: mostly legal, often subtly illegal (every class of mistake the rules forbid). */
export function rawPick(
  rules: Rules,
  rng: Rng,
): { winner: Slot | null | 0 | 3; sets: number | null; scores: unknown } {
  const w: Slot = rng.pick([1, 2] as const);
  const n: 2 | 3 = rng.chance(0.5) ? 2 : 3;
  const sets = legalMatch(rules, rng, w, n);
  const obj = (s: Set) => ({ p1_games: s[0], p2_games: s[1] });
  const r = rng.next();
  if (r < 0.55) return { winner: w, sets: n, scores: sets.map(obj) };
  if (r < 0.63) {
    // one set illegal (6-5, 8-6, 6-6, 5-3 …)
    const i = rng.int(0, n - 1);
    sets[i] = illegalSet(rules, rng);
    return { winner: w, sets: n, scores: sets.map(obj) };
  }
  if (r < 0.73) {
    // random set winners (third set after 2-0, the winner losing two sets, a loser-side score …)
    return {
      winner: w,
      sets: n,
      scores: Array.from({ length: n }, () => obj(legalSet(rules, rng, rng.pick([1, 2] as const)))),
    };
  }
  if (r < 0.78) {
    // the other player named as winner of a legal score line
    return { winner: w === 1 ? 2 : 1, sets: n, scores: sets.map(obj) };
  }
  if (r < 0.83) {
    // set count and scores disagree
    const m = rng.pick([1, 2, 3, 4]);
    const sc = Array.from({ length: m }, () => obj(anySet(rules, rng)));
    return { winner: w, sets: rng.pick([2, 3]), scores: sc };
  }
  if (r < 0.87) return { winner: w, sets: rng.pick([1, 4, null] as const), scores: sets.map(obj) };
  if (r < 0.89) return { winner: rng.pick([null, 0, 3] as const), sets: n, scores: sets.map(obj) };
  // malformed set entries
  const i = rng.int(0, n - 1);
  const bad = rng.pick([
    { p1_games: "6", p2_games: 4 },
    { p1_games: 6.5, p2_games: 4 },
    { p1_games: -1, p2_games: 6 },
    { p1_games: 6 },
    null,
    [6, 4],
    { p1_games: 6, p2_games: null },
  ] as unknown[]);
  const sc: unknown[] = sets.map(obj);
  sc[i] = bad;
  return {
    winner: w,
    sets: n,
    scores: rng.chance(0.1) ? rng.pick([null, "6-4", {}] as unknown[]) : sc,
  };
}

/** Converts a raw scores value to the oracle's [p1, p2] pairs without judging it. */
export function toPairs(scores: unknown): unknown {
  if (!Array.isArray(scores)) return scores;
  return scores.map((s) =>
    s && typeof s === "object" && !Array.isArray(s)
      ? [(s as Record<string, unknown>)["p1_games"], (s as Record<string, unknown>)["p2_games"]]
      : ["not a set"],
  );
}

/** A provider's final result: about 70 % valid by construction, the rest fuzzed. */
export function rawResult(rules: Rules, rng: Rng): { status: Status; winner: Slot; sets: Set[] } {
  const w: Slot = rng.pick([1, 2] as const);
  const r = rng.next();
  if (r < 0.5)
    return {
      status: "completed",
      winner: w,
      sets: legalMatch(rules, rng, w, rng.chance(0.5) ? 2 : 3),
    };
  if (r < 0.58) return { status: "walkover", winner: w, sets: [] };
  if (r < 0.7) {
    // a plausible retirement: complete sets so far (nobody on two), then maybe an unfinished one
    const done = rng.int(0, 2);
    const sets: Set[] = [];
    if (done >= 1) sets.push(legalSet(rules, rng, rng.pick([1, 2] as const)));
    if (done === 2) sets.push(legalSet(rules, rng, sets[0]![0] > sets[0]![1] ? 2 : 1));
    if (rng.chance(0.7)) {
      let s: Set;
      do s = [rng.int(0, 6), rng.int(0, 6)];
      while (isLegalSet(rules, s));
      sets.push(s);
    }
    return { status: "retired", winner: w, sets };
  }
  // fuzz: anything
  const status = rng.pick(["completed", "completed", "retired", "walkover"] as const);
  const n = rng.pick([0, 1, 2, 2, 3, 3, 4]);
  const sets = Array.from({ length: n }, () =>
    rng.chance(0.15) ? ([rng.int(0, 8), rng.int(0, 8)] as Set) : anySet(rules, rng),
  );
  return { status, winner: w, sets };
}
