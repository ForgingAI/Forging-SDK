// UUIDv7 generator for `mutation_id`.
//
// Layout (per draft-ietf-uuidrev-rfc4122bis §5.7):
//   - 48 bits: Unix epoch millisecond timestamp (big-endian)
//   - 4 bits:  Version (0b0111 = 7)
//   - 12 bits: Random A (rand_a)
//   - 2 bits:  Variant (0b10)
//   - 62 bits: Random B (rand_b)
//
// We emit the canonical hyphenated form `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`
// (lowercase hex). The wire format expects `z.string().uuid()` which DOES
// require hyphens — see packages/rooms-sdk/src/wire-format.ts MutationMessage.
// (The task description mentions a "no-dashes for compactness" variant for
// participant_id elsewhere in social-api; for mutation_id we follow the wire
// schema strictly.)
//
// Crypto source: `globalThis.crypto.getRandomValues` when available; falls
// back to `Math.random` only in non-browser non-Node environments where
// crypto is missing (test environments may inject a fake).
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (this module — UUIDv7 for mutation_id).
//   - Wire format §"Client → server messages" (mutation_id is `z.string().uuid()`).

/** Bytes provider. Default uses `crypto.getRandomValues`; tests can inject. */
export type RandomBytesFn = (length: number) => Uint8Array;

const cryptoLike = (() => {
  // `globalThis.crypto` exists in browsers and Node 19+; guard for older.
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  return c && typeof c.getRandomValues === "function" ? c : null;
})();

const defaultRandomBytes: RandomBytesFn = (length: number) => {
  const arr = new Uint8Array(length);
  if (cryptoLike) {
    cryptoLike.getRandomValues!(arr);
    return arr;
  }
  // Fallback: not cryptographically strong, but acceptable for test envs
  // where the caller injects deterministic bytes.
  for (let i = 0; i < length; i += 1) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
};

/** Time source — `Date.now` by default; tests inject a deterministic clock. */
export type NowFn = () => number;

/** Hex-encode a Uint8Array as lowercase. */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Generate a UUIDv7 string in canonical hyphenated form.
 *
 * The returned string matches `z.string().uuid()` and is monotonically
 * (loosely) ordered by creation time across processes within a millisecond.
 */
export function uuidV7(
  now: NowFn = Date.now,
  randomBytes: RandomBytesFn = defaultRandomBytes,
): string {
  const ts = Math.max(0, Math.floor(now()));
  // 48-bit timestamp split into two 32-bit chunks for safe arithmetic.
  const tsHigh = Math.floor(ts / 0x100000000); // top 16 bits live here
  const tsLow = ts >>> 0; // bottom 32 bits

  const rand = randomBytes(10); // 10 bytes of randomness for rand_a (12b) + rand_b (62b)

  // Assemble the 16-byte UUID buffer.
  const b = new Uint8Array(16);
  // Bytes 0-5: 48-bit timestamp, big-endian.
  b[0] = (tsHigh >>> 8) & 0xff;
  b[1] = tsHigh & 0xff;
  b[2] = (tsLow >>> 24) & 0xff;
  b[3] = (tsLow >>> 16) & 0xff;
  b[4] = (tsLow >>> 8) & 0xff;
  b[5] = tsLow & 0xff;
  // Bytes 6-7: version (top 4 bits = 0111) + 12 bits rand_a.
  b[6] = 0x70 | ((rand[0] ?? 0) & 0x0f); // version=7 in top nibble, low nibble = rand
  b[7] = rand[1] ?? 0;
  // Bytes 8-9: variant (top 2 bits = 10) + 62 bits rand_b.
  b[8] = 0x80 | ((rand[2] ?? 0) & 0x3f); // variant=10 in top 2 bits, low 6 = rand
  b[9] = rand[3] ?? 0;
  b[10] = rand[4] ?? 0;
  b[11] = rand[5] ?? 0;
  b[12] = rand[6] ?? 0;
  b[13] = rand[7] ?? 0;
  b[14] = rand[8] ?? 0;
  b[15] = rand[9] ?? 0;

  const hex = bytesToHex(b);
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}
