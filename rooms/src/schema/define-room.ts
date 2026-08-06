// `defineRoom` — declarative room schema. One source of truth that feeds
// every typed hook returned by `createRoomApp`.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.2 (the factory's `hooks` object is itself the
//     inference unit). The Zod schemas declared here are what every hook in
//     downstream user code reads its types from.
//
// Design notes:
// - We accept a `state` and `participantState` declared as a RECORD of key→Zod.
//   This is more ergonomic than wrapping users in one big z.object — it keeps
//   per-key versioning at the wire layer and matches the DO SQLite row shape
//   (PRIMARY KEY is `key`).
// - `lifecycle` is a tuple of allowed phase names; the SDK assumes the first
//   element is the initial phase.
// - `leaderboards` is a record of name→LeaderboardSpec. Names are constrained
//   at the type level so `useLeaderboard(name)` can fail to compile on typos.

import type { z } from "zod";

import type { LeaderboardSpec } from "./leaderboard";
import type { MarkerKind } from "./markers";

/** Allowed lifecycle phase identifiers. Mirrored in the worker's
 *  `RoomLifecycle` type (Worker types.ts) — keep in sync. */
export type LifecyclePhase = "lobby" | "active" | "paused" | "ended";

/** Per-key state map. Each entry is a Zod schema (optionally marked with
 *  `crdt()` / `counter()`). The key is the wire-level address. */
export type StateSchemaMap = Readonly<Record<string, z.ZodTypeAny>>;

/** Same shape for participant-scoped state; per-participant per-key. */
export type ParticipantStateSchemaMap = Readonly<Record<string, z.ZodTypeAny>>;

/** Record of leaderboard name → spec. */
export type LeaderboardMap = Readonly<Record<string, LeaderboardSpec>>;

/**
 * Input to `defineRoom`. All four fields are required to keep the API
 * predictable; pass empty objects/arrays when a section is unused.
 */
export interface RoomSpec<
  S extends StateSchemaMap,
  P extends ParticipantStateSchemaMap,
  L extends LeaderboardMap,
  Phases extends readonly LifecyclePhase[],
> {
  readonly state: S;
  readonly participantState: P;
  readonly leaderboards: L;
  readonly lifecycle: Phases;
}

/**
 * The typed handle returned by `defineRoom`. This is the inference unit
 * that flows through `createRoomApp` and into every hook on the returned
 * `app.hooks` namespace.
 *
 * The object is deeply frozen so consumers cannot mutate it after creation
 * (immutability rule from ~/.claude/rules/common/coding-style.md).
 */
export interface RoomDefinition<
  S extends StateSchemaMap = StateSchemaMap,
  P extends ParticipantStateSchemaMap = ParticipantStateSchemaMap,
  L extends LeaderboardMap = LeaderboardMap,
  Phases extends readonly LifecyclePhase[] = readonly LifecyclePhase[],
> {
  readonly state: S;
  readonly participantState: P;
  readonly leaderboards: L;
  readonly lifecycle: Phases;
  /** Brand to make `RoomDefinition` nominal — prevents accidental shape-only
   *  matches passing as a definition without going through `defineRoom`. */
  readonly __brand: "ForgingRoomDefinition";
}

/**
 * Build a `RoomDefinition` from a `RoomSpec`. Returns a frozen, typed handle.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { defineRoom, counter, defineLeaderboard } from "@forging/rooms";
 *
 * export const TriviaRoom = defineRoom({
 *   state: {
 *     phase: z.enum(["lobby", "active", "ended"]),
 *     currentQuestion: z.string().nullable(),
 *   },
 *   participantState: {
 *     answer: z.string().nullable(),
 *     score: counter({ min: 0, init: 0 }),
 *   },
 *   leaderboards: {
 *     leaderboard: defineLeaderboard({ scoring: "sum" }),
 *   },
 *   lifecycle: ["lobby", "active", "ended"] as const,
 * });
 * ```
 */
export function defineRoom<
  S extends StateSchemaMap,
  P extends ParticipantStateSchemaMap,
  L extends LeaderboardMap,
  Phases extends readonly LifecyclePhase[],
>(spec: RoomSpec<S, P, L, Phases>): RoomDefinition<S, P, L, Phases> {
  // Defensive: shallow-freeze the spec sections. We don't deep-freeze Zod
  // schemas (they're class instances with internal mutable bookkeeping in
  // some Zod versions); freezing the maps is enough to guarantee callers
  // can't add/remove keys post-hoc.
  const frozen: RoomDefinition<S, P, L, Phases> = Object.freeze({
    state: Object.freeze({ ...spec.state }) as S,
    participantState: Object.freeze({ ...spec.participantState }) as P,
    leaderboards: Object.freeze({ ...spec.leaderboards }) as L,
    lifecycle: Object.freeze([...spec.lifecycle]) as unknown as Phases,
    __brand: "ForgingRoomDefinition" as const,
  });
  return frozen;
}

// ─── Type utilities ─────────────────────────────────────────────────────────

/** Extract the inferred state object type from a `RoomDefinition`.
 *  Maps each key in `state` to its `z.infer<...>` result. */
export type RoomStateOf<R extends RoomDefinition> = {
  readonly [K in keyof R["state"]]: R["state"][K] extends z.ZodTypeAny
    ? z.infer<R["state"][K]>
    : never;
};

/** Extract the inferred participant-state object type from a `RoomDefinition`. */
export type ParticipantStateOf<R extends RoomDefinition> = {
  readonly [K in keyof R["participantState"]]: R["participantState"][K] extends z.ZodTypeAny
    ? z.infer<R["participantState"][K]>
    : never;
};

/** Union of valid leaderboard names for `useLeaderboard(name)` inference. */
export type LeaderboardNamesOf<R extends RoomDefinition> =
  keyof R["leaderboards"] & string;

/** Union of valid state-key names. Used for typed `useRoomState('key')` form. */
export type StateKeysOf<R extends RoomDefinition> = keyof R["state"] & string;

/** Union of valid participant-state key names. */
export type ParticipantStateKeysOf<R extends RoomDefinition> =
  keyof R["participantState"] & string;

/** Union of allowed lifecycle phases declared on a definition. */
export type LifecycleOf<R extends RoomDefinition> = R["lifecycle"][number];

/** Type-level helper: extract the value type at one state key. */
export type StateValueAt<
  R extends RoomDefinition,
  K extends StateKeysOf<R>,
> = R["state"][K] extends z.ZodTypeAny ? z.infer<R["state"][K]> : never;

/** Type-level helper: extract the value type at one participant-state key. */
export type ParticipantStateValueAt<
  R extends RoomDefinition,
  K extends ParticipantStateKeysOf<R>,
> = R["participantState"][K] extends z.ZodTypeAny
  ? z.infer<R["participantState"][K]>
  : never;

/** Type-level helper: extract the marker kind for a state key (for use by
 *  hooks that want to gate behavior on marker semantics). Phase 1 returns
 *  the declared kind from the symbol attachment via `readMarker` at runtime;
 *  at type level we conservatively widen to `MarkerKind`. */
export type MarkerKindOf = MarkerKind;
