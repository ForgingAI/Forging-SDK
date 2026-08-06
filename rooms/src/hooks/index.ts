// Hook namespace bound to a `RoomDefinition`. The hook bodies live in
// per-hook files (see `./use-*`); this module composes them into a single
// `BoundHooks<R>` object via `buildHooks(room)` which is what
// `createRoomApp(...)` exposes as `app.hooks`.
//
// Implementation owners (per .planning/.../PLAN.md Sub-track 1.2):
//   - useRoomState         → task 1.2.4 (./use-room-state.ts)
//   - useParticipantState  → task 1.2.4 (./use-room-state.ts)
//   - useLeaderboard       → task 1.2.7 (./use-leaderboard.ts)
//   - useHostControls      → task 1.2.6 (./use-host-controls.ts)
//   - useRoom              → task 1.2.5 (./use-room.ts)
//   - useRoomPresence      → task 1.2.6 (./use-room-presence.ts)
//   - useReactions         → task 1.2.7 (./use-reactions.ts)
//   - useRoomLifecycle     → task 1.2.5 (./use-room-lifecycle.ts)

import type { RoomDefinition } from "../schema/define-room";

import type {
  UseHostControlsHook,
  UseLeaderboardHook,
  UseParticipantStateHook,
  UseReactionsHook,
  UseRoomHook,
  UseRoomLifecycleHook,
  UseRoomPresenceHook,
  UseRoomStateHook,
} from "./types";

import { createUseHostControls } from "./use-host-controls";
import { createUseLeaderboard } from "./use-leaderboard";
import { createUseRoom } from "./use-room";
import { createUseRoomLifecycle } from "./use-room-lifecycle";
import { useRoomPresence } from "./use-room-presence";
import {
  createUseParticipantState,
  createUseRoomState,
} from "./use-room-state";
import { useReactions } from "./use-reactions";

/**
 * Build the hook namespace bound to a `RoomDefinition`. The generic parameter
 * `R` is the load-bearing piece — it threads the schema-inferred types into
 * every hook signature exposed downstream.
 */
export interface BoundHooks<R extends RoomDefinition> {
  readonly useRoomState: UseRoomStateHook<R>;
  readonly useParticipantState: UseParticipantStateHook<R>;
  readonly useLeaderboard: UseLeaderboardHook<R>;
  readonly useHostControls: UseHostControlsHook<R>;
  readonly useRoom: UseRoomHook<R>;
  readonly useRoomPresence: UseRoomPresenceHook;
  readonly useReactions: UseReactionsHook;
  readonly useRoomLifecycle: UseRoomLifecycleHook<R>;
}

export function buildHooks<R extends RoomDefinition>(
  _room: R,
): BoundHooks<R> {
  // Every hook reads its `RoomApp` (and therefore the captured definition)
  // through the React context provider. The `_room` argument is preserved on
  // the signature so the factory captures `R` for downstream type inference.
  void _room;
  return Object.freeze({
    useRoomState: createUseRoomState<R>(),
    useParticipantState: createUseParticipantState<R>(),
    useLeaderboard: createUseLeaderboard<R>(),
    useHostControls: createUseHostControls<R>(),
    useRoom: createUseRoom<R>(),
    useRoomPresence,
    useReactions,
    useRoomLifecycle: createUseRoomLifecycle<R>(),
  });
}

// Re-export hook factories and standalone hooks so advanced consumers can
// reach them directly (test harnesses, custom wrappers).
export {
  createUseHostControls,
  createUseLeaderboard,
  createUseRoom,
  createUseRoomLifecycle,
  createUseParticipantState,
  createUseRoomState,
  useReactions,
  useRoomPresence,
};
