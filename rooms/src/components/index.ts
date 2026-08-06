// Public component barrel for `@forging/rooms/components`.
//
// Each component lives in its own file. Prop types are co-located with their
// component and re-exported here for ergonomic single-line imports.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 tasks 1.2.6, 1.2.8, 1.2.9.

export { HostOnly, ParticipantOnly } from "./role-gates";
export type { HostOnlyProps, ParticipantOnlyProps } from "./role-gates";

export { JoinFlow } from "./join-flow";
export type { JoinFlowProps, JoinFlowPhase } from "./join-flow";

export { RoomCodeDisplay } from "./room-code-display";
export type { RoomCodeDisplayProps } from "./room-code-display";

export { PresenceStrip } from "./presence-strip";
export type { PresenceStripProps } from "./presence-strip";

export { Leaderboard } from "./leaderboard";
export type { LeaderboardProps } from "./leaderboard";

export { HostControlPanel } from "./host-control-panel";
export type { HostControlPanelProps } from "./host-control-panel";

export { StaleIndicator } from "./stale-indicator";
export type { StaleIndicatorProps } from "./stale-indicator";

export { ReactionsOverlay } from "./reactions-overlay";
export type { ReactionsOverlayProps } from "./reactions-overlay";

export { RoomLifecycleGate } from "./room-lifecycle-gate";
export type { RoomLifecycleGateProps } from "./room-lifecycle-gate";

export type { ThemeTokens } from "./theme";
export { defaultTheme, resolveTheme } from "./theme";
