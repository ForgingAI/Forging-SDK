/**
 * Wordlist invariants — protects the canonical room-code data files from
 * regressions during curation.
 *
 * These tests run via vitest from the package root (`pnpm --filter
 * @forging/rooms test`). Curation policy lives in WORDLIST_PROVENANCE.md.
 */
import { describe, expect, it } from "vitest";
import wordlist from "./wordlist.json";
import bannedPairs from "./banned-pairs.json";

const WORDLIST: ReadonlyArray<string> = wordlist as ReadonlyArray<string>;
const BANNED_PAIRS: ReadonlyArray<readonly [string, string]> =
  bannedPairs as ReadonlyArray<readonly [string, string]>;

describe("room-code wordlist", () => {
  it("contains exactly 1024 entries", () => {
    expect(WORDLIST.length).toBe(1024);
  });

  it("every entry is exactly 4 characters", () => {
    const offending = WORDLIST.filter((w) => w.length !== 4);
    expect(offending).toEqual([]);
  });

  it("every entry is uppercase A-Z", () => {
    const re = /^[A-Z]{4}$/;
    const offending = WORDLIST.filter((w) => !re.test(w));
    expect(offending).toEqual([]);
  });

  it("contains no duplicates", () => {
    const unique = new Set(WORDLIST);
    expect(unique.size).toBe(WORDLIST.length);
  });

  it("is alphabetically sorted", () => {
    const sorted = [...WORDLIST].sort();
    expect(WORDLIST).toEqual(sorted);
  });

  it("contains no obviously offensive entries", () => {
    // Spot-check against a hard-coded baseline of words that MUST NOT appear.
    // This is a regression guard against accidental re-introduction during
    // future PRs; the canonical decision-maker is human review per
    // WORDLIST_PROVENANCE.md.
    const baseline = [
      "FUCK", "SHIT", "CUNT", "PISS", "RAPE", "PORN", "COCK", "DICK", "TITS",
      "SLUT", "WHOR", "FAGS", "KIKE", "GOOK", "SPIC", "DAGO", "NAZI", "NIGG",
      "PAKI", "ANAL", "ANUS", "ARSE", "BOOB", "CRAP", "TURD", "TWAT", "JIZZ",
      "WANK", "WANG", "POON", "PUSS", "DYKE", "HOMO", "JAPS", "WOPS", "YIDS",
      "DOPE", "METH", "COKE", "VAPE", "WEED", "BONG", "AIDS", "HERP", "GORE",
      "KILL", "MURD", "NUKE", "AMAZ", "GOOG", "ESPN", "XBOX",
    ];
    const wordset = new Set(WORDLIST);
    const violations = baseline.filter((b) => wordset.has(b));
    expect(violations).toEqual([]);
  });
});

describe("banned-pairs", () => {
  it("contains at least 20 pairs", () => {
    expect(BANNED_PAIRS.length).toBeGreaterThanOrEqual(20);
  });

  it("every pair is a 2-tuple of strings", () => {
    for (const pair of BANNED_PAIRS) {
      expect(Array.isArray(pair)).toBe(true);
      expect(pair.length).toBe(2);
      expect(typeof pair[0]).toBe("string");
      expect(typeof pair[1]).toBe("string");
    }
  });

  it("every pair entry is a member of the wordlist (no orphans)", () => {
    const wordset = new Set(WORDLIST);
    const orphans: Array<readonly [string, string]> = [];
    for (const pair of BANNED_PAIRS) {
      const [a, b] = pair;
      if (!wordset.has(a) || !wordset.has(b)) {
        orphans.push(pair);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("contains no duplicate pairs (canonical ordering only)", () => {
    const seen = new Set<string>();
    const duplicates: Array<readonly [string, string]> = [];
    for (const pair of BANNED_PAIRS) {
      const [a, b] = pair;
      const key = `${a}|${b}`;
      if (seen.has(key)) {
        duplicates.push(pair);
      } else {
        seen.add(key);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("contains no reverse-duplicates — allocator checks both (A,B) and (B,A)", () => {
    // The allocator is documented to check `(A, B)` and `(B, A)` orderings.
    // To keep the data file small and reviewable, we store only one ordering
    // per banned combination. This invariant catches the same combination
    // entered twice with the words swapped.
    const seenSorted = new Set<string>();
    const reversedDupes: Array<readonly [string, string]> = [];
    for (const pair of BANNED_PAIRS) {
      const [a, b] = pair;
      const sortedKey = [a, b].sort().join("|");
      if (seenSorted.has(sortedKey)) {
        reversedDupes.push(pair);
      } else {
        seenSorted.add(sortedKey);
      }
    }
    expect(reversedDupes).toEqual([]);
  });
});
