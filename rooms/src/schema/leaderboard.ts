// Leaderboard schema — declaration helpers used inside `defineRoom`.
//
// A leaderboard is a named score table attached to a room. Each award is
// addressed by participant id; multiple awards combine according to `scoring`.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.2 (Leaderboard is a first-class concept on the
//     RoomDefinition; hook surface is `useLeaderboard(name)`).

import type { z } from "zod";

/**
 * How multiple awards to the same participant combine.
 *
 * - `sum`: add scores together (default for trivia, points-based games).
 * - `max`: keep the highest score per participant (best-of, time-trials).
 * - `min`: keep the lowest score per participant (golf-style, latency).
 */
export type LeaderboardScoring = "sum" | "max" | "min";

/**
 * Whether the leaderboard outlives the room or not.
 *
 * - `room-scoped`: deleted when the room ends and is archived.
 * - `app-scoped`: persists across rooms under the same `app_id` (cross-room
 *   tournament tables). This is the default for most user-visible boards.
 */
export type LeaderboardPersistence = "app-scoped" | "room-scoped";

/**
 * Declarative spec for one leaderboard. Each award optionally carries
 * `metadata` (Zod-validated) — e.g., the question id, the team name, a
 * timestamp — so consumers can render rich rows.
 *
 * @example
 * ```ts
 * const trivia = defineLeaderboard({
 *   scoring: "sum",
 *   persistence: "app-scoped",
 *   metadata: z.object({ questionId: z.string() }),
 * });
 * ```
 */
export interface LeaderboardSpec<M extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly scoring: LeaderboardScoring;
  readonly persistence: LeaderboardPersistence;
  /** Optional Zod schema for the award metadata payload. */
  readonly metadata?: M;
}

/**
 * Construct a `LeaderboardSpec`. Pass-through with defaults applied so the
 * call site stays declarative.
 *
 * Defaults:
 * - `scoring: "sum"`
 * - `persistence: "app-scoped"`
 *
 * @example
 * ```ts
 * defineLeaderboard({ scoring: "max" });
 * defineLeaderboard({ metadata: z.object({ team: z.string() }) });
 * ```
 */
export function defineLeaderboard<M extends z.ZodTypeAny = z.ZodTypeAny>(
  spec: Partial<LeaderboardSpec<M>> = {},
): LeaderboardSpec<M> {
  const scoring: LeaderboardScoring = spec.scoring ?? "sum";
  const persistence: LeaderboardPersistence = spec.persistence ?? "app-scoped";
  if (spec.metadata !== undefined) {
    return Object.freeze({
      scoring,
      persistence,
      metadata: spec.metadata,
    }) as LeaderboardSpec<M>;
  }
  return Object.freeze({
    scoring,
    persistence,
  }) as LeaderboardSpec<M>;
}

/** Type-level helper: extract the metadata TypeScript type from a spec. */
export type LeaderboardMetadataOf<S extends LeaderboardSpec> =
  S extends LeaderboardSpec<infer M>
    ? M extends z.ZodTypeAny
      ? z.infer<M>
      : undefined
    : undefined;
