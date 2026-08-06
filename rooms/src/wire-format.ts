// Forging Rooms — client/server wire format.
//
// This MUST match packages/rooms-worker/src/wire-format.ts exactly. When
// changing, update both. Future: extract to a shared `@forging/rooms-protocol`
// package so the Worker and SDK depend on one canonical source. For Phase 1 we
// keep these schemas duplicated to avoid the cross-package build complexity.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - "Wire format (client ↔ server)" (lines 353-388)
//   - Sub-track 1.2 (SDK) — task 1.2.1 / 1.2.2.
//
// All messages are JSON. Versioned via `proto: z.literal(1)`. Future protocol
// bumps require a new literal and a coexistence story; for Phase 1 we ship
// exactly one protocol version.
//
// IMPORTANT: The reject reason enum (see `RejectMessageSchema` below) is the
// SOURCE OF TRUTH for both the SDK and the Worker. If extending the enum:
// update BOTH this file AND `packages/rooms-worker/src/wire-format.ts` in
// the same PR. The Worker's `RejectReasonSchema` must mirror this enum
// exactly or the SDK's Zod parse will silently fall through to a generic
// transport error.

import { z } from "zod";

// ─── Common primitives ─────────────────────────────────────────────────────

/** Protocol version. Bump deliberately; do not silently change. */
export const PROTO_VERSION = 1 as const;

/** RFC-6902 JSON Patch document. We type this minimally — runtime validation
 *  of each op is delegated to the server-side applier (it has the schema). */
export const JsonPatchOpSchema = z.object({
  op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
  path: z.string(),
  value: z.unknown().optional(),
  from: z.string().optional(),
});
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

export const JsonPatchSchema = z.array(JsonPatchOpSchema);
export type JsonPatch = z.infer<typeof JsonPatchSchema>;

/** Mutation target — which logical store the patch applies to.
 *
 * - `state` / `participantState`: JSON-Patch mutations against room or
 *   participant-scoped state cells. Optimistically applied; server may
 *   reject on `version_conflict` / `validation_failed`.
 * - `leaderboard.award`: an atomic score award to the current participant.
 *   `key` is the leaderboard name; `patch` is a single `replace /score`
 *   op carrying the award amount and optional metadata payload. The server
 *   translates this into an atomic `UpdateItem ADD score` against DDB
 *   (Research-1b Finding 5 / Pitfall 5).
 * - `host.action`: a server-validated host RPC (setPhase / kick / endRoom).
 *   `key` is the action name; `patch` is a single `replace /args` op with
 *   the action's argument object.
 * - `reactions.send`: a participant-scoped fire-and-forget reaction. The
 *   server fans out a `state_delta` for the reactions slot. `key` is fixed
 *   to `"send"` for forward-compatibility; `patch` carries `{ emoji, at }`.
 *
 * NOTE: Task 1.2.7 added `reactions.send` on the SDK side. The Worker
 * (task 1.1.7d, sibling) must mirror this enum addition.
 */
export const MutationTargetSchema = z.enum([
  "state",
  "participantState",
  "leaderboard.award",
  "host.action",
  "reactions.send",
]);
export type MutationTarget = z.infer<typeof MutationTargetSchema>;

/** Lifecycle phase identifier — matches RoomLifecycle in the Worker types. */
export const LifecyclePhaseSchema = z.enum([
  "lobby",
  "active",
  "paused",
  "ended",
  "expired",
]);
export type LifecyclePhase = z.infer<typeof LifecyclePhaseSchema>;

/** Participant role — host or participant. */
export const ParticipantRoleSchema = z.enum(["host", "participant"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

// ─── Client → server messages ──────────────────────────────────────────────

/**
 * Mutation message — the client proposes a JSON Patch against `target/key`.
 * The server validates, applies under the optimistic concurrency guard of
 * `expected_version`, and replies with `ack` or `reject`.
 */
export const MutationMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("mutation"),
  mutation_id: z.string().uuid(),
  target: MutationTargetSchema,
  key: z.string().min(1),
  patch: JsonPatchSchema,
  expected_version: z.number().int().nonnegative(),
});
export type MutationMessage = z.infer<typeof MutationMessageSchema>;

/**
 * Ping message — client-initiated keepalive. Server replies with a `pong`.
 * Used by the SDK for round-trip latency measurement and visibility-loss
 * detection.
 */
export const PingMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("ping"),
  client_ts: z.number().int().nonnegative(),
});
export type PingMessage = z.infer<typeof PingMessageSchema>;

/** Discriminated union of all client→server messages. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  MutationMessageSchema,
  PingMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → client messages ──────────────────────────────────────────────

/**
 * StateDelta — authoritative broadcast that some `target/key` has a new value
 * at `version`. Every state-bearing event carries a monotonic `seq` used for
 * reconnect dedupe via `lastEventId`.
 */
export const StateDeltaMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("state_delta"),
  seq: z.number().int().nonnegative(),
  target: MutationTargetSchema,
  key: z.string().min(1),
  value: z.unknown(),
  version: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type StateDeltaMessage = z.infer<typeof StateDeltaMessageSchema>;

/** ReplayBegin — server is about to replay buffered events for catch-up. */
export const ReplayBeginMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("replay_begin"),
  from_seq: z.number().int().nonnegative(),
  to_seq: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type ReplayBeginMessage = z.infer<typeof ReplayBeginMessageSchema>;

/** ReplayEnd — replay window is fully delivered; resume live mode. */
export const ReplayEndMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("replay_end"),
  last_seq: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type ReplayEndMessage = z.infer<typeof ReplayEndMessageSchema>;

/**
 * ReplayError — server cannot fulfil incremental replay and is signalling
 * the SDK to drop cached state and request a fresh state snapshot.
 *
 * Emitted by the Worker when the catch-up window would exceed the cap
 * (`too_many_events`, currently 10,000 rows) or when the client's
 * `lastEventId` falls before the 5-minute event_log retention floor
 * (`retention_gap`, reserved for a follow-up task). The runtime in
 * `connection.ts` handles this by clearing `connection.lastSeq`, marking
 * the store stale, and letting the next state mutation re-establish a
 * fresh authoritative view.
 *
 * MUST remain byte-identical to the Worker side
 * (`packages/rooms-worker/src/wire-format.ts::ServerReplayErrorSchema`).
 */
export const ReplayErrorMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("replay_error"),
  reason: z.enum(["too_many_events", "retention_gap"]),
  since_seq: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type ReplayErrorMessage = z.infer<typeof ReplayErrorMessageSchema>;

/** Ack — server applied a mutation. `seq` is the post-apply event seq. */
export const AckMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("ack"),
  in_reply_to: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type AckMessage = z.infer<typeof AckMessageSchema>;

/** Reject — server refused a mutation. `reason` is a stable machine code. */
export const RejectMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("reject"),
  in_reply_to: z.string().uuid(),
  reason: z.enum([
    "version_conflict",
    "validation_failed",
    "permission_denied",
    "unknown_target",
    "rate_limited",
    "phase_disallows",
    "server_error",
  ]),
  message: z.string(),
  server_ts: z.number().int().nonnegative(),
});
export type RejectMessage = z.infer<typeof RejectMessageSchema>;

/** Pong — server reply to a ping; includes the original client_ts. */
export const PongMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("pong"),
  client_ts: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
});
export type PongMessage = z.infer<typeof PongMessageSchema>;

/** Presence — participant joined/left/roster update. */
export const PresenceEntrySchema = z.object({
  participant_id: z.string(),
  display_name: z.string(),
  role: ParticipantRoleSchema,
  connection_state: z.enum(["online", "offline", "reconnecting"]),
  joined_at: z.number().int().nonnegative(),
});
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>;

export const PresenceMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("presence"),
  seq: z.number().int().nonnegative(),
  event: z.enum(["join", "leave", "update", "snapshot"]),
  participants: z.array(PresenceEntrySchema),
  server_ts: z.number().int().nonnegative(),
});
export type PresenceMessage = z.infer<typeof PresenceMessageSchema>;

/** Lifecycle — room phase transition. */
export const LifecycleMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("lifecycle"),
  seq: z.number().int().nonnegative(),
  phase: LifecyclePhaseSchema,
  prev_phase: LifecyclePhaseSchema.nullable(),
  server_ts: z.number().int().nonnegative(),
});
export type LifecycleMessage = z.infer<typeof LifecycleMessageSchema>;

/**
 * LeaderboardUpdate — broadcast by the Worker immediately after an atomic
 * `UpdateItem ADD score :s` lands against `forging-leaderboards` for the
 * `(board, participant_id)` carried in the message.
 *
 * Leaderboards are app-scoped and outlive any single room, so this message
 * deliberately has NO `seq` — it does not participate in the per-room
 * `event_log` replay protocol. `server_ts` is the only ordering primitive.
 *
 * The Worker emits this to EVERY connection in the room, including the
 * award sender, so a participant sees their own score reflected immediately
 * after submitting (the UI doesn't have to optimistically apply locally).
 *
 * MUST remain byte-identical to the Worker side
 * (`packages/rooms-worker/src/wire-format.ts::ServerLeaderboardUpdateSchema`).
 * If either schema changes, change both.
 */
export const LeaderboardUpdateMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("leaderboard_update"),
  board: z.string().min(1),
  participant_id: z.string().min(1),
  score: z.number(),
  display_name: z.string(),
  server_ts: z.number().int().nonnegative(),
});
export type LeaderboardUpdateMessage = z.infer<typeof LeaderboardUpdateMessageSchema>;

/**
 * ReactionBroadcast — server fan-out for an ephemeral participant reaction
 * (task 1.1.7d). Reactions are NOT part of `event_log` and DO NOT advance
 * the SDK's `lastProcessedSeq`. The runtime routes this to a dedicated
 * `applyReaction` path on the store rather than the `state_delta` reducer,
 * so reactions never land in `state` / `participantState` cells.
 *
 * `seq` is fixed at `0` on the wire — retained for envelope-shape
 * uniformity. The sender also receives this broadcast (intentional local
 * echo per PLAN.md task 1.1.7d step 4).
 *
 * MUST remain byte-identical to the Worker side
 * (`packages/rooms-worker/src/wire-format.ts::ServerReactionBroadcastSchema`).
 * Update both or neither.
 */
export const ReactionBroadcastMessageSchema = z.object({
  proto: z.literal(PROTO_VERSION),
  type: z.literal("reaction"),
  seq: z.number().int().nonnegative(),
  server_ts: z.number().int().nonnegative(),
  participant_id: z.string().min(1),
  emoji: z.string().min(1),
});
export type ReactionBroadcastMessage = z.infer<typeof ReactionBroadcastMessageSchema>;

/** Discriminated union of all server→client messages. */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  StateDeltaMessageSchema,
  ReplayBeginMessageSchema,
  ReplayEndMessageSchema,
  ReplayErrorMessageSchema,
  AckMessageSchema,
  RejectMessageSchema,
  PongMessageSchema,
  PresenceMessageSchema,
  LifecycleMessageSchema,
  LeaderboardUpdateMessageSchema,
  ReactionBroadcastMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
