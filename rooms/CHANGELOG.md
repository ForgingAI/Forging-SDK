# Changelog

All notable changes to `@forging/rooms` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 - 2026-05-14

Initial release. Phase 1 alpha — primitives only.

- Schema layer: `defineRoom`, `defineLeaderboard`, `counter`, `crdt`, marker
  helpers, full type-inference utilities.
- Factory: `createRoomApp` returning a typed `app.hooks` namespace bound to
  the captured `RoomDefinition`.
- Runtime: `RoomConnection`, `RoomStore`, `SendQueue`, reconnect math,
  visibility coordinator, wake-lock manager, uuidV7 id generator.
- Hooks: `useRoomState`, `useParticipantState`, `useLeaderboard`,
  `useHostControls`, `useRoom`, `useRoomPresence`, `useReactions`,
  `useRoomLifecycle`, `useWakeLock`.
- Components (`@forging/rooms/components`): `JoinFlow`, `RoomCodeDisplay`,
  `PresenceStrip`, `Leaderboard`, `HostControlPanel`, `StaleIndicator`,
  `ReactionsOverlay`, `RoomLifecycleGate`, `HostOnly` / `ParticipantOnly`
  role gates, default theme tokens.
- Wire format: proto v1 client/server messages — `mutation`, `ping`,
  `state_delta`, `replay_begin/end/error`, `ack`, `reject`, `pong`,
  `presence`, `lifecycle`, `leaderboard_update`, `reaction`.
- Build: tsup-driven ESM bundles for `.` and `./components`; per-entry
  `.d.ts`; `"use client"` banner on the components entry for Next.js App
  Router consumers.
