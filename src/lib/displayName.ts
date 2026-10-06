// Names that imitate the game's own staff (Tino, 6 Oct 2026). The database decides
// (public.display_name_reserved, migration 0051); this mirror lets Join say so before the code is sent.
// tests/displayName.test.ts keeps the two in agreement. Same steps as name_skeleton: fold wide letters
// (NFKC) and look-alikes, lower-case A-Z, keep only Latin a-z and the Arabic base letters.
const C = String.fromCharCode;

// look-alike → base letter, as code points (no look-alike characters in this file)
const FOLD = new Map<number, string>([
  // digits and symbols
  [48, "o"],
  [49, "i"],
  [51, "e"],
  [52, "a"],
  [53, "s"],
  [55, "t"],
  [64, "a"],
  [36, "s"],
  // Cyrillic lower + upper
  [1072, "a"],
  [1077, "e"],
  [1082, "k"],
  [1084, "m"],
  [1086, "o"],
  [1088, "p"],
  [1089, "c"],
  [1091, "y"],
  [1093, "x"],
  [1110, "i"],
  [1112, "j"],
  [1109, "s"],
  [1281, "d"],
  [1231, "l"],
  [1040, "a"],
  [1045, "e"],
  [1050, "k"],
  [1052, "m"],
  [1053, "h"],
  [1054, "o"],
  [1056, "p"],
  [1057, "c"],
  [1058, "t"],
  [1059, "y"],
  [1061, "x"],
  [1030, "i"],
  [1032, "j"],
  [1029, "s"],
  // Greek lower + upper
  [945, "a"],
  [949, "e"],
  [953, "i"],
  [954, "k"],
  [957, "v"],
  [959, "o"],
  [961, "p"],
  [964, "t"],
  [965, "u"],
  [967, "x"],
  [913, "a"],
  [914, "b"],
  [917, "e"],
  [918, "z"],
  [919, "h"],
  [921, "i"],
  [922, "k"],
  [924, "m"],
  [925, "n"],
  [927, "o"],
  [929, "p"],
  [932, "t"],
  [933, "y"],
  [935, "x"],
  // Latin look-alikes
  [305, "i"],
  [593, "a"],
  // Arabic letter variants: alef with hamza/madda → alef, waw/yeh with hamza, alef maqsura, teh marbuta
  [1571, C(1575)],
  [1573, C(1575)],
  [1570, C(1575)],
  [1572, C(1608)],
  [1574, C(1610)],
  [1609, C(1610)],
  [1577, C(1607)],
]);
const NOT_A_LETTER = new RegExp(`[^a-z${C(1569)}-${C(1610)}]|${C(1600)}`, "g");

export function nameSkeleton(name: string): string {
  let out = "";
  for (const ch of name.normalize("NFKC")) out += FOLD.get(ch.codePointAt(0)!) ?? ch;
  return out.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(NOT_A_LETTER, "");
}

const WORDS = new Set(
  [
    "admin",
    "admins",
    "administrator",
    "moderator",
    "mod team",
    "staff",
    "support",
    "official",
    "system",
    "operator",
    "organiser",
    "organizer",
    "team",
    "the team",
    "host",
    "مشرف",
    "المشرف",
    "إدارة",
    "الإدارة",
    "مدير",
    "المدير",
    "مسؤول",
    "المسؤول",
    "دعم",
    "الدعم",
  ].map(nameSkeleton),
);
const INSIDE = ["Call the Crown", "توقع التاج", "Grand Slam GM", "administrator", "moderator"].map(
  nameSkeleton,
);

/** True when a display name could be taken for the game's own team. */
export function reservedName(name: string): boolean {
  const k = nameSkeleton(name);
  if (!k) return false;
  return (
    WORDS.has(k) ||
    INSIDE.some((w) => k.includes(w)) ||
    /^(admin|official)/.test(k) ||
    /(admin|official)$/.test(k)
  );
}
