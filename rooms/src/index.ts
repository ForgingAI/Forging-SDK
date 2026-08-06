// @forging/rooms — public package surface.
//
// Design contract: hooks like `useRoomState` are ONLY reachable through the
// return value of `createRoomApp(...)`. They are not re-exported here.
// Schema-less calls fail to compile because the hooks live on
// `app.hooks` and are typed against the captured `RoomDefinition`.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
// Sub-track 1.2 for the full hook implementation roadmap.

// ─── Schema builders ───────────────────────────────────────────────────────

export {
  defineRoom,
  defineLeaderboard,
  crdt,
  counter,
  FORGING_MARKER,
  readMarker,
} from "./schema/index";

export type {
  RoomDefinition,
  RoomSpec,
  RoomStateOf,
  ParticipantStateOf,
  LeaderboardNamesOf,
  StateKeysOf,
  ParticipantStateKeysOf,
  StateValueAt,
  ParticipantStateValueAt,
  LifecycleOf,
  LifecyclePhase,
  StateSchemaMap,
  ParticipantStateSchemaMap,
  LeaderboardMap,
  LeaderboardSpec,
  LeaderboardScoring,
  LeaderboardPersistence,
  LeaderboardMetadataOf,
  CounterOptions,
  MarkerAttachment,
  MarkerKind,
  Marked,
} from "./schema/index";

// ─── Factory ───────────────────────────────────────────────────────────────

export { createRoomApp } from "./app/create-room-app";
export type {
  CreateRoomAppOptions,
  RoomApp,
  RoomPersistence,
} from "./app/create-room-app";

// ─── Hook surface types (advanced consumers) ──────────────────────────────
// We export the type signatures so consumers can write wrappers/helpers
// around `app.hooks`, but we do NOT export the hook implementations — they
// must be reached via the factory return value.

export type {
  BoundHooks,
} from "./hooks/index";

export type {
  ConnectionStatus,
  HookMeta,
  Mutator,
  ReadonlyMutator,
  UseRoomStateHook,
  UseParticipantStateHook,
  UseLeaderboardHook,
  UseLeaderboardResult,
  LeaderboardEntry,
  UseHostControlsHook,
  HostControlActions,
  UseRoomHook,
  RoomMeta,
  UseRoomPresenceHook,
  PresenceParticipant,
  UseReactionsHook,
  UseReactionsResult,
  UseRoomLifecycleHook,
  UseRoomLifecycleResult,
} from "./hooks/types";

// ─── Wire-format (advanced consumers — debugging, custom transports) ──────

export {
  PROTO_VERSION,
  ClientMessageSchema,
  ServerMessageSchema,
  MutationMessageSchema,
  PingMessageSchema,
  StateDeltaMessageSchema,
  ReplayBeginMessageSchema,
  ReplayEndMessageSchema,
  AckMessageSchema,
  RejectMessageSchema,
  PongMessageSchema,
  PresenceMessageSchema,
  LifecycleMessageSchema,
} from "./wire-format";

export type {
  ClientMessage,
  ServerMessage,
  MutationMessage,
  PingMessage,
  StateDeltaMessage,
  ReplayBeginMessage,
  ReplayEndMessage,
  AckMessage,
  RejectMessage,
  PongMessage,
  PresenceMessage,
  LifecycleMessage,
  PresenceEntry,
  MutationTarget,
  ParticipantRole,
  LifecyclePhase as WireLifecyclePhase,
  JsonPatch,
  JsonPatchOp,
} from "./wire-format";

// ─── Runtime (advanced consumers — direct connection access) ──────────────
// The runtime is normally consumed through `app.connection` and the React
// context provider; these exports are for tests and advanced integrations.

export {
  RoomConnection,
  RoomStore,
  SendQueue,
  MutationRejectedError,
  nextDelay,
  RECONNECT_CONSTANTS,
  REACTIONS_WINDOW,
  uuidV7,
} from "./runtime/index";

export type {
  RoomConnectionOptions,
  GetAuthTokenFn,
  RoomTransport,
  RoomTransportFactory,
  RoomTransportFactoryArgs,
  RoomStoreSnapshot,
  StateCell,
  ParticipantPresence,
  LifecycleSnapshot,
  ConnectionSnapshot,
  LeaderboardRow,
  ReactionEvent,
  Selector,
  Unsubscribe,
  AckResult,
  RejectReason,
  SendFn,
  RandomFn,
  VisibilityCoordinatorOptions,
  VisibilityCallbacks,
  PageShowEvent,
  WakeLockManagerOptions,
  WakeLockSentinelLike,
} from "./runtime/index";

export { VisibilityCoordinator, WakeLockManager } from "./runtime/index";

// ─── React hooks (page-lifecycle / wake lock) ─────────────────────────────

export { useWakeLock } from "./hooks/use-wake-lock";

// ─── React context (provider + internal context hook) ─────────────────────

export {
  RoomAppProvider,
  useRoomAppContext,
  useRoomAppContextOptional,
} from "./runtime/react-context";

export type { RoomAppProviderProps } from "./runtime/react-context";

// ─── Shared utilities ─────────────────────────────────────────────────────

export type { JsonPrimitive, JsonValue } from "./types";
