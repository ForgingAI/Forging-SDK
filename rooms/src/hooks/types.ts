// Hook type signatures, parameterized over a `RoomDefinition`. These types
// drive both the placeholder hook bodies in `hooks/index.ts` and the
// public surface returned by `createRoomApp().hooks`.
//
// The mutation hooks return a tuple `[currentState, mutate, meta]` where
// `mutate` receives an Immer recipe that operates on a DRAFT OF CURRENT
// SERVER STATE — not a closure of render-time state. This is the load-bearing
// design choice from Research-1b Finding 1 / Pitfall 6.

import type { Draft } from "immer";

import type {
  LeaderboardNamesOf,
  LifecycleOf,
  ParticipantStateKeysOf,
  ParticipantStateOf,
  ParticipantStateValueAt,
  RoomDefinition,
  RoomStateOf,
  StateKeysOf,
  StateValueAt,
} from "../schema/define-room";
import type { LeaderboardMetadataOf } from "../schema/leaderboard";

// ─── Common meta / connection status ───────────────────────────────────────

/** Lifecycle of the underlying WebSocket connection, as observable to React.
 *
 * - `idle`         — RoomConnection constructed, `connect()` not yet called.
 * - `connecting`   — initial socket open in progress.
 * - `live`         — fully connected, send queue draining.
 * - `replaying`    — between server's `replay_begin` and `replay_end`.
 * - `reconnecting` — socket closed; backoff timer is running.
 * - `disconnected` — terminal state after `disconnect()` or 30s grace failure.
 */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "replaying"
  | "disconnected";

export interface HookMeta {
  readonly status: ConnectionStatus;
  readonly lastSyncedAt: number | null;
  readonly version: number;
  /** True when the local optimistic view diverges from the last server seq. */
  readonly stale: boolean;
}

/** Recipe-style mutator: receives an Immer draft of the CURRENT server state. */
export type Mutator<T> = (
  recipe: (draft: Draft<T>) => void,
) => Promise<void>;

// ─── useRoomState ──────────────────────────────────────────────────────────

/**
 * `useRoomState()` — two overloads:
 *
 * 1. No argument: returns `[state, mutate, meta]` where `state` is the full
 *    inferred state object and `mutate` operates on the whole shape.
 * 2. With a key: returns `[value, mutate, meta]` scoped to that key. Compile
 *    error if `key` is not declared in the room's `state` map.
 */
export interface UseRoomStateHook<R extends RoomDefinition> {
  (): readonly [
    RoomStateOf<R> | null,
    Mutator<RoomStateOf<R>>,
    HookMeta,
  ];
  <K extends StateKeysOf<R>>(
    key: K,
  ): readonly [
    StateValueAt<R, K> | null,
    Mutator<StateValueAt<R, K>>,
    HookMeta,
  ];
}

// ─── useParticipantState ───────────────────────────────────────────────────

/**
 * `useParticipantState()` — read/write participant-scoped state.
 *
 * - With a key alone: read+write the CURRENT participant's value at that key.
 * - With a key + participantId: read another participant's value. The returned
 *   `mutate` function will reject at runtime; the type system marks the
 *   mutator as `never`-bound to discourage attempts.
 */
export interface UseParticipantStateHook<R extends RoomDefinition> {
  (): readonly [
    ParticipantStateOf<R> | null,
    Mutator<ParticipantStateOf<R>>,
    HookMeta,
  ];
  <K extends ParticipantStateKeysOf<R>>(
    key: K,
  ): readonly [
    ParticipantStateValueAt<R, K> | null,
    Mutator<ParticipantStateValueAt<R, K>>,
    HookMeta,
  ];
  <K extends ParticipantStateKeysOf<R>>(
    key: K,
    participantId: string,
  ): readonly [
    ParticipantStateValueAt<R, K> | null,
    ReadonlyMutator,
    HookMeta,
  ];
}

/** A mutator that always rejects — used for cross-participant reads. */
export type ReadonlyMutator = (
  recipe: (draft: Draft<never>) => void,
) => Promise<never>;

// ─── useLeaderboard ────────────────────────────────────────────────────────

export interface LeaderboardEntry<M = undefined> {
  readonly participantId: string;
  readonly displayName: string;
  readonly score: number;
  readonly rank: number;
  readonly metadata: M;
}

export interface UseLeaderboardResult<M = undefined> {
  readonly entries: readonly LeaderboardEntry<M>[];
  readonly status: ConnectionStatus;
  /** Award a score to the current participant. Resolves on server ack. */
  readonly submit: (
    score: number,
    metadata?: M,
  ) => Promise<void>;
}

/** Bind `useLeaderboard(name)` to the declared leaderboard names. */
export type UseLeaderboardHook<R extends RoomDefinition> = <
  N extends LeaderboardNamesOf<R>,
>(
  name: N,
) => UseLeaderboardResult<
  LeaderboardMetadataOf<R["leaderboards"][N]> extends undefined
    ? undefined
    : LeaderboardMetadataOf<R["leaderboards"][N]>
>;

// ─── useHostControls ───────────────────────────────────────────────────────

/** Discriminated by role: host gets the full action set; participant gets null. */
export interface HostControlActions<R extends RoomDefinition> {
  readonly setPhase: (phase: LifecycleOf<R>) => Promise<void>;
  readonly kick: (participantId: string) => Promise<void>;
  readonly endRoom: () => Promise<void>;
}

export type UseHostControlsHook<R extends RoomDefinition> = () =>
  | HostControlActions<R>
  | null;

// ─── useRoom / useRoomPresence / useReactions / useRoomLifecycle ──────────

export interface RoomMeta<R extends RoomDefinition> {
  readonly code: string;
  readonly url: string;
  readonly phase: LifecycleOf<R>;
  readonly participantCount: number;
  readonly status: ConnectionStatus;
}

export type UseRoomHook<R extends RoomDefinition> = () => RoomMeta<R>;

export interface PresenceParticipant {
  readonly participantId: string;
  readonly displayName: string;
  readonly role: "host" | "participant";
  readonly online: boolean;
  readonly joinedAt: number;
}

export type UseRoomPresenceHook = () => readonly PresenceParticipant[];

export interface UseReactionsResult {
  readonly send: (emoji: string) => Promise<void>;
  readonly recent: readonly {
    readonly emoji: string;
    readonly fromParticipantId: string;
    readonly at: number;
  }[];
}

export type UseReactionsHook = () => UseReactionsResult;

export interface UseRoomLifecycleResult<R extends RoomDefinition> {
  readonly phase: LifecycleOf<R>;
  readonly transitionTo: (phase: LifecycleOf<R>) => Promise<void>;
  readonly allowed: readonly LifecycleOf<R>[];
}

export type UseRoomLifecycleHook<R extends RoomDefinition> =
  () => UseRoomLifecycleResult<R>;
