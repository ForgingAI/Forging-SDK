// Runtime module barrel. The runtime is reachable from
// `create-room-app.ts` and the React context provider; downstream consumers
// generally don't import this directly.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (runtime introduction).

export {
  RoomConnection,
  type RoomConnectionOptions,
  type GetAuthTokenFn,
  type RoomTransport,
  type RoomTransportFactory,
  type RoomTransportFactoryArgs,
} from "./connection";

export {
  RoomStore,
  REACTIONS_WINDOW,
  type RoomStoreSnapshot,
  type StateCell,
  type ParticipantPresence,
  type LifecycleSnapshot,
  type ConnectionSnapshot,
  type LeaderboardRow,
  type ReactionEvent,
  type Selector,
  type Unsubscribe,
} from "./store";

export {
  SendQueue,
  MutationRejectedError,
  type AckResult,
  type RejectReason,
  type SendQueueOptions,
  type SendFn,
} from "./send-queue";

export { nextDelay, RECONNECT_CONSTANTS, type RandomFn } from "./reconnect";

export { uuidV7, type NowFn, type RandomBytesFn } from "./ids";

export {
  VisibilityCoordinator,
  type VisibilityCoordinatorOptions,
  type VisibilityCallbacks,
  type PageShowEvent,
} from "./visibility";

export {
  WakeLockManager,
  type WakeLockManagerOptions,
  type WakeLockSentinelLike,
} from "./wake-lock";
