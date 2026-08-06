# Room-Code Wordlist Provenance

Canonical curation notes for `wordlist.json` and `banned-pairs.json` in this
directory. These files back the Forging Multiplayer room-code allocator
(plan task 1.1.2 of `phase-01-rooms-infra`).

## Purpose

Room codes are formed as `WORD-WORD` (e.g., `PLUM-FROG`). Each word is exactly
4 letters, A-Z. With 1024 words on each side, the keyspace is 1024 x 1024 =
1,048,576 ordered pairs. Collision-handling is at the allocator level
(separate task 1.1.3); this list just supplies the words.

## Sources

In order of preference. Each candidate word passes through the filtering
pipeline below regardless of source.

1. **EFF Diceware Short Wordlist 2.0** —
   `https://www.eff.org/files/2016/09/08/eff_short_wordlist_2_0.txt`
   (1296 entries, max 5 chars, no homophones).
   Filter to exactly 4 chars: ~47 words.

2. **EFF Diceware Short Wordlist 1** —
   `https://eff.org/files/2016/09/08/eff_short_wordlist_1.txt`
   (1296 entries). Filter to 4 chars: ~432 words.

3. **EFF Diceware Large Wordlist** —
   `https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt`
   (7776 entries). Filter to 4 chars: ~467 words.

   Combined unique EFF 4-char words: **546**.

4. **Hand-curated supplemental 4-letter common English words** drawn from
   `/usr/share/dict/words` (the BSD `web2` dictionary on macOS), restricted
   to a `PRIORITY_COMMON` whitelist of high-frequency English words that
   read cleanly as room codes. Maintained inside the curation script.

The EFF Diceware wordlists are public domain. The curated 1024-word subset
distributed here is maintained by the Forging team.

## Filtering Pipeline

Applied **in order**:

1. **Length** — keep only words of exactly 4 letters.
2. **Alphabet** — keep only A-Z (drop accents, hyphens, apostrophes).
3. **Casing** — canonicalize to uppercase. Codes are displayed uppercase.
4. **Profanity blocklist** — drop words that are offensive **in isolation**.
   The current blocklist is embedded in the curation script and covers:
   - Common English profanity, slurs, sexual terms.
   - Drug terms and paraphernalia.
   - Ableist and body-shaming language.
   - Medical-sensitive terms (e.g., AIDS, HERPES variants).
   - Politically charged short-forms.
   - Brand and trademark hits.
   - Pure-repeat strings (e.g., `OOOO`) and internet vulgar shorthand.
   - Profanity homophones that read offensively in CAPS.
5. **Combination-offensive filtering** — words that are individually clean
   but read offensively in combination (e.g., `BARE` + `SKIN`) are kept in
   the wordlist and filtered at allocation time via `banned-pairs.json`.
   The allocator checks **both** `(A, B)` and `(B, A)` orderings against
   the banned-pairs list and retries on a hit.
6. **Final size enforcement** — produce exactly **1024** words. The curation
   script uses the following priority order when more than 1024 candidates
   survive filtering:
   1. The `PRIORITY_COMMON` set (~924 high-frequency English words) is
      included first, with a per-letter round-robin to keep distribution
      balanced across the alphabet.
   2. Remaining slots are filled from the EFF source (most linguistically
      vetted) in alphabetic order.
   3. If still short, supplemental and safe-extras pools fill the tail.

## Final Counts

| Stage | Count |
|---|---|
| Source candidates after length+alphabet | ~5400 |
| Combined unique EFF 4-char words | 546 |
| EFF dropped via blocklist | 5 |
| EFF post-blocklist | 541 |
| Supplemental (hand-curated, in sys-dict) | ~881 |
| Supplemental post-blocklist | ~879 |
| Priority commons kept | ~919 |
| **Final wordlist size** | **1024** |
| **Banned pairs** | **101** |

## Date Curated

Initial canonical curation: **2026-05-14**.

## Update Process

The wordlist is a **canonical, versioned, hand-curated artifact**. Treat it
like a schema, not a generated artifact.

Automated profanity filters miss too much. The canonical decision-maker for
inclusion/exclusion is the **human curator** during PR review.

### To add a word

1. Open a PR that:
   - Adds the new word to `PRIORITY_COMMON` in the curation script (or to
     a future explicit `ADDITIONS` set).
   - Removes one existing word from the final list to keep the total at 1024
     (or proposes growing the list with a corresponding ARCH note that
     accounts for the keyspace and birthday-collision impact at the
     allocator level).
   - Updates the date in this file.
   - Adds banned-pair entries against existing words for any combination
     that reads offensively (use `WORD-WORD` mental test).
2. Re-run the curation script and commit the regenerated `wordlist.json`
   and `banned-pairs.json`.
3. Re-run `wordlist.test.ts` and verify all assertions pass.

### To remove a word

1. Open a PR that:
   - Adds the word to the `BLOCKLIST` in the curation script with a brief
     comment explaining why (e.g., "trademark conflict", "ableist slang").
   - Adds a replacement word from `PRIORITY_COMMON` or another vetted
     source to keep the total at 1024.
   - Removes any banned-pair entries referencing the removed word.
2. Re-run the curation script and commit the regenerated files.

### To add a banned pair

1. Open a PR that adds the `[WORD_A, WORD_B]` entry to the `candidate_pairs`
   list in the curation script.
2. Both words must already exist in `wordlist.json`.
3. The allocator checks both orderings, so add the pair only in canonical
   alphabetic order (e.g., `[BARE, SKIN]`, not both `[BARE, SKIN]` and
   `[SKIN, BARE]`).

## Known Concerns / Items Flagged for Human Review

The following words remain in the wordlist after automated filtering and
human review. They are **borderline** — clean primary meaning, but with a
secondary slang/sexual/violent association. Banned-pairs cover the obvious
offensive combinations, but a future curator pass may choose to remove
any of these if a real-world room code reads badly:

- `DEAD` — clean as in "dead battery"; risky if paired with `BODY`, `MEAT`,
  `HEAD` (covered by banned-pairs).
- `HUMP` — clean as in "camel hump", "speed hump"; slang sexual meaning
  exists. Banned-pairs cover `HUMP-DAY`, `HUMP-BACK` and similar.
- `HORN` — clean as in musical horn; "horny" association exists.
- `LAID` — clean past tense of "to lay"; sexual idiom exists ("get laid").
  Banned-pairs cover `LAID-BACK`, `LAID-DOWN`.
- `LOAD` — clean as in "truck load"; sexual idiom exists.
- `MOAN` — clean as in "moan in pain"; sexual idiom exists.
- `POKE` — clean as in "poke a hole"; sexual idiom exists.
- `RAGE` — clean as in "rage quit a game"; violent association exists.
- `RACK` — clean as in "spice rack"; sexual idiom exists.
- `RIPE` — clean as in "ripe fruit"; "ripe for the picking" sexual
  innuendo exists.
- `WHIP` — clean as in "whip cream"; BDSM association exists.

If a future incident report flags any of these in production, the maintenance
process is documented above.

## Implementation Notes

The curation script that produced these files is **not** checked in here —
it lives outside the SDK package because it depends on local system files
(`/usr/share/dict/words`) and external EFF downloads. To re-curate, the
canonical reference is this provenance document plus the source URLs listed
above. Any maintainer can re-derive the list deterministically from those
inputs given the filtering rules and the `PRIORITY_COMMON` whitelist.

## Files

- `wordlist.json` — JSON array of exactly 1024 uppercase 4-letter strings,
  alphabetically sorted.
- `banned-pairs.json` — JSON array of `[WORD_A, WORD_B]` pairs (101 entries
  as of the initial curation). The allocator checks both orderings.
- `wordlist.test.ts` — Vitest invariants for the two data files above.
