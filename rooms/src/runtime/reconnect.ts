// Reconnect backoff schedule.
//
// PartySocket's own backoff defaults (1s min, 10s max, 1.3× factor) are
// reasonable, but for the Forging SDK we want a slightly more aggressive
// early curve so the *first* reconnect happens fast (250ms) — this is the
// expected case during transient network blips on mobile. After a handful of
// attempts we cap at 30s, matching the 30s disconnect grace window from
// PLAN.md §"Wire format" and Sub-track 1.2 task 1.2.5.
//
// The schedule is a pure function of attempt number. The connection class
// owns the integer `attempt` counter — see `runtime/connection.ts`.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (this module).
//   - Sub-track 1.2 task 1.2.5 (the 30s grace window — same cap as here).

/** Fixed base curve, in milliseconds. Index = attempt number (0-based).
 *  After the last element we plateau at the final value. Jitter is added on
 *  top per call to `nextDelay`. */
const BACKOFF_CURVE_MS: readonly number[] = [
  250, 500, 1000, 2000, 5000, 10000, 30000, 30000,
] as const;

/** Hard ceiling regardless of curve / jitter. Matches the disconnect grace. */
const MAX_DELAY_MS = 30000;

/** Jitter as a fraction of the base delay (0..0.25 added on top, uniform). */
const JITTER_FRACTION = 0.25;

/**
 * Deterministic random source. Defaults to `Math.random`; tests inject a
 * deterministic generator (e.g. a Mulberry32 sequence) so the curve is
 * reproducible.
 */
export type RandomFn = () => number;

/**
 * Compute the delay before reconnect attempt `attempt` (0-based).
 *
 * - attempt 0 → 250ms + jitter
 * - attempt 1 → 500ms + jitter
 * - attempt 2 → 1000ms + jitter
 * - attempt 3 → 2000ms + jitter
 * - attempt 4 → 5000ms + jitter
 * - attempt 5 → 10000ms + jitter
 * - attempt 6+ → 30000ms + jitter (capped at 30000)
 *
 * Jitter is uniform in [0, 25%] of the base delay; the post-jitter value is
 * clamped to MAX_DELAY_MS so the curve never exceeds the 30s grace.
 */
export function nextDelay(attempt: number, rand: RandomFn = Math.random): number {
  if (!Number.isFinite(attempt) || attempt < 0) {
    throw new Error(
      `[@forging/rooms] nextDelay: attempt must be a finite non-negative number, got ${String(attempt)}`,
    );
  }
  const idx = Math.min(Math.floor(attempt), BACKOFF_CURVE_MS.length - 1);
  // Guarded by the floor+min above; the indexed access is provably defined
  // but `noUncheckedIndexedAccess` widens the result, so we re-narrow.
  const base = BACKOFF_CURVE_MS[idx] ?? MAX_DELAY_MS;
  const jitter = base * JITTER_FRACTION * rand();
  return Math.min(Math.floor(base + jitter), MAX_DELAY_MS);
}

/** Expose the constants for tests and downstream consumers. */
export const RECONNECT_CONSTANTS = Object.freeze({
  BACKOFF_CURVE_MS,
  MAX_DELAY_MS,
  JITTER_FRACTION,
});
