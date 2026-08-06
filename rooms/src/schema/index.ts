// Schema layer — `defineRoom`, marker helpers, and inference utilities.
// Re-exports are intentionally narrow so the public package surface is small.

export {
  defineRoom,
  type RoomDefinition,
  type RoomSpec,
  type RoomStateOf,
  type ParticipantStateOf,
  type LeaderboardNamesOf,
  type StateKeysOf,
  type ParticipantStateKeysOf,
  type StateValueAt,
  type ParticipantStateValueAt,
  type LifecycleOf,
  type LifecyclePhase,
  type StateSchemaMap,
  type ParticipantStateSchemaMap,
  type LeaderboardMap,
} from "./define-room";

export {
  defineLeaderboard,
  type LeaderboardSpec,
  type LeaderboardScoring,
  type LeaderboardPersistence,
  type LeaderboardMetadataOf,
} from "./leaderboard";

export {
  crdt,
  counter,
  readMarker,
  FORGING_MARKER,
  type CounterOptions,
  type MarkerAttachment,
  type MarkerKind,
  type Marked,
} from "./markers";
