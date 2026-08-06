// Observable in-memory store for the Forging Rooms runtime.
//
// Holds the fully-reconciled view of the room as projected from server
// broadcasts (`state_delta`, `presence`, `lifecycle`, `replay_begin/end`).
// The React hook surface (task 1.2.4) reads through `subscribe` / `getSnapshot`.
//
// Design rules:
// - Snapshots returned to subscribers are SHALLOW-FROZEN to discourage mutation.
//   Deep-freezing would force a recursive walk on every dispatch; we frieze the
//   outer object plus the four top-level Maps' wrapper objects. Map entries
//   themselves are also frozen at insertion time.
// - Subscriber selectors are pure functions; the store calls each selector on
//   every change and only fires its onChange if the result differs by
//   `Object.is`. This is the same contract React's `useSyncExternalStore`
//   uses internally and lets us memoize aggressively at the hook layer later.
// - Drop-dupes: we track `lastProcessedSeq`; any incoming server message whose
//   `seq` is <= that is ignored.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (this module).
//   - Sub-track 1.2 task 1.2.5 (reconnect protocol & replay state machine).

import type {
  LifecycleMessage,
  LifecyclePhase,
  ParticipantRole,
  PresenceEntry,
  PresenceMessage,
  ReactionBroadcastMessage,
  StateDeltaMessage,
} from "../wire-format";

import type { ConnectionStatus } from "../hooks/types";

// ─── Public snapshot shapes ────────────────────────────────────────────────

/** A single state cell — value + monotonic version + server timestamp. */
export interface StateCell {
  readonly value: unknown;
  readonly version: number;
  readonly server_ts: number;
}

export interface ParticipantPresence {
  readonly displayName: string;
  readonly role: ParticipantRole;
  readonly online: boolean;
  readonly joinedAt: number;
}

export interface LifecycleSnapshot {
  readonly phase: LifecyclePhase | null;
  readonly since: number;
}

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  readonly lastSeq: number;
  readonly reconnectAttempt: number;
}

/** One row in a leaderboard slot. */
export interface LeaderboardRow {
  readonly participantId: string;
  readonly displayName: string;
  readonly score: number;
  readonly rank: number;
  readonly metadata: unknown;
}

/** One reaction event observed in the rolling client-side window. */
export interface ReactionEvent {
  readonly emoji: string;
  readonly fromParticipantId: string;
  readonly at: number;
}

/** Max number of recent reactions retained client-side. */
export const REACTIONS_WINDOW = 20;

/**
 * The full store snapshot. All Maps are frozen at the outer reference (insertion
 * happens on copy-on-write inside the dispatchers). Selectors should treat the
 * snapshot as immutable; mutation will throw in strict mode.
 */
export interface RoomStoreSnapshot {
  readonly roomState: ReadonlyMap<string, StateCell>;
  readonly participantState: ReadonlyMap<string, ReadonlyMap<string, StateCell>>;
  readonly participants: ReadonlyMap<string, ParticipantPresence>;
  readonly lifecycle: LifecycleSnapshot;
  readonly connection: ConnectionSnapshot;
  /** Leaderboard rows keyed by leaderboard name. Each list is ordered by
   *  descending score (or scoring-rule equivalent) as broadcast by the server. */
  readonly leaderboards: ReadonlyMap<string, readonly LeaderboardRow[]>;
  /** Most recent reactions (max {@link REACTIONS_WINDOW}, FIFO). */
  readonly reactions: readonly ReactionEvent[];
  /** Highest seq applied to this snapshot (drop-dupes anchor). */
  readonly lastProcessedSeq: number;
}

// ─── Selector + subscription types ─────────────────────────────────────────

export type Selector<T> = (snapshot: RoomStoreSnapshot) => T;
export type Unsubscribe = () => void;

interface Subscriber<T> {
  readonly selector: Selector<T>;
  readonly onChange: (next: T) => void;
  /** Last value the selector produced. Compared via Object.is. */
  lastValue: T;
}

// ─── Internal mutable snapshot scratch ─────────────────────────────────────

// We keep the public Map types as ReadonlyMap, but internally hold native Maps
// and clone-on-write into new frozen wrappers when state changes. The clone is
// O(N) only for the top-level Map; entries are reused by reference.

interface InternalSnapshot {
  roomState: Map<string, StateCell>;
  participantState: Map<string, Map<string, StateCell>>;
  participants: Map<string, ParticipantPresence>;
  lifecycle: LifecycleSnapshot;
  connection: ConnectionSnapshot;
  leaderboards: Map<string, readonly LeaderboardRow[]>;
  reactions: readonly ReactionEvent[];
  lastProcessedSeq: number;
}

function emptyInternal(): InternalSnapshot {
  return {
    roomState: new Map(),
    participantState: new Map(),
    participants: new Map(),
    lifecycle: Object.freeze({ phase: null, since: 0 }),
    connection: Object.freeze({ status: "idle" as ConnectionStatus, lastSeq: 0, reconnectAttempt: 0 }),
    leaderboards: new Map(),
    reactions: Object.freeze([]) as readonly ReactionEvent[],
    lastProcessedSeq: 0,
  };
}

function freezeSnapshot(s: InternalSnapshot): RoomStoreSnapshot {
  return Object.freeze({
    roomState: s.roomState,
    participantState: s.participantState,
    participants: s.participants,
    lifecycle: s.lifecycle,
    connection: s.connection,
    leaderboards: s.leaderboards,
    reactions: s.reactions,
    lastProcessedSeq: s.lastProcessedSeq,
  });
}

// ─── The store class ──────────────────────────────────────────────────────

export class RoomStore {
  private internal: InternalSnapshot = emptyInternal();
  private snapshot: RoomStoreSnapshot = freezeSnapshot(this.internal);
  private readonly subscribers: Set<Subscriber<unknown>> = new Set();
  /** True while inside a replay window (between replay_begin and replay_end). */
  private replaying = false;

  // ─── Public read API ─────────────────────────────────────────────────────

  /** Frozen snapshot suitable for `useSyncExternalStore`. */
  getSnapshot(): RoomStoreSnapshot {
    return this.snapshot;
  }

  /** Latest fully-reconciled state — alias for getSnapshot used by 1.2.4. */
  getCurrentState(): RoomStoreSnapshot {
    return this.snapshot;
  }

  /** Subscribe to a derived value. Fires `onChange(value)` whenever the
   *  selector's result changes (Object.is). Returns an unsubscribe fn. */
  subscribe<T>(selector: Selector<T>, onChange: (next: T) => void): Unsubscribe {
    const initial = selector(this.snapshot);
    const sub: Subscriber<T> = { selector, onChange, lastValue: initial };
    // Store as Subscriber<unknown> for the Set; the cast is local and safe.
    this.subscribers.add(sub as Subscriber<unknown>);
    return () => {
      this.subscribers.delete(sub as Subscriber<unknown>);
    };
  }

  // ─── Public dispatch API ────────────────────────────────────────────────

  applyStateDelta(msg: StateDeltaMessage): void {
    if (msg.seq <= this.internal.lastProcessedSeq) return; // drop-dupe
    const next: InternalSnapshot = { ...this.internal };
    const cell: StateCell = Object.freeze({
      value: msg.value,
      version: msg.version,
      server_ts: msg.server_ts,
    });
    if (msg.target === "state") {
      const m = new Map(this.internal.roomState);
      m.set(msg.key, cell);
      next.roomState = m;
    } else if (msg.target === "participantState") {
      // Wire format encodes participant_state cells with key `${participantId}:${field}`
      // by convention; the worker may either split before sending or use a structured
      // sub-key. For Phase 1 the store accepts the wire `key` verbatim and stores it
      // under the synthetic root `__participant__` slot in roomState; task 1.2.4
      // will adapt this to the per-participant Map once the worker shape is final.
      // To keep the contract flexible, we ALSO populate participantState if the key
      // is colon-separated.
      const colon = msg.key.indexOf(":");
      if (colon > 0) {
        const pid = msg.key.slice(0, colon);
        const field = msg.key.slice(colon + 1);
        const outer = new Map(this.internal.participantState);
        const inner = new Map(outer.get(pid) ?? new Map<string, StateCell>());
        inner.set(field, cell);
        outer.set(pid, inner);
        next.participantState = outer;
      } else {
        const m = new Map(this.internal.roomState);
        m.set(`__participant__:${msg.key}`, cell);
        next.roomState = m;
      }
    } else if (msg.target === "leaderboard.award") {
      // Server broadcasts a refreshed leaderboard top-N as an array under
      // `value`. `key` is the leaderboard name.
      const rows = normalizeLeaderboardRows(msg.value);
      if (rows === null) return;
      const lb = new Map(this.internal.leaderboards);
      lb.set(msg.key, rows);
      next.leaderboards = lb;
    } else if (msg.target === "reactions.send") {
      // Reactions used to arrive as `state_delta` with target
      // `reactions.send`; task 1.1.7d split them out into a dedicated
      // top-level `reaction` server message handled by `applyReaction`.
      // We keep this branch tolerant for backwards compatibility against
      // any Worker still on the pre-1.1.7d wire format — drop without
      // mutating snapshot lastProcessedSeq advancement below.
      const event = normalizeReactionEvent(msg.value, msg.server_ts);
      if (event === null) return;
      const tail = this.internal.reactions.slice(
        Math.max(0, this.internal.reactions.length - (REACTIONS_WINDOW - 1)),
      );
      next.reactions = Object.freeze([...tail, event]);
    } else {
      // host.action — no observable state at the client layer; the server
      // emits separate state_delta / lifecycle / presence broadcasts that
      // reflect the action's effects.
      return;
    }
    next.lastProcessedSeq = msg.seq;
    next.connection = Object.freeze({ ...this.internal.connection, lastSeq: msg.seq });
    this.commit(next);
  }

  /**
   * Append a reaction broadcast to the rolling FIFO window.
   *
   * Reactions are ephemeral (task 1.1.7d): they are NOT part of
   * `event_log`, do NOT carry a meaningful `seq` (server pins `seq=0`),
   * and DO NOT advance `lastProcessedSeq`. The sender also receives this
   * broadcast — local echo is intentional UX feedback per the plan.
   *
   * Drops oldest entries when the window exceeds {@link REACTIONS_WINDOW}.
   */
  applyReaction(msg: ReactionBroadcastMessage): void {
    const event: ReactionEvent = Object.freeze({
      emoji: msg.emoji,
      fromParticipantId: msg.participant_id,
      at: msg.server_ts,
    });
    const next: InternalSnapshot = { ...this.internal };
    const tail = this.internal.reactions.slice(
      Math.max(0, this.internal.reactions.length - (REACTIONS_WINDOW - 1)),
    );
    next.reactions = Object.freeze([...tail, event]);
    this.commit(next);
  }

  // ─── Selector helpers ───────────────────────────────────────────────────

  /** Pure selector: read a single state cell value, or null if absent. */
  selectStateValue(key: string): unknown {
    return this.snapshot.roomState.get(key)?.value ?? null;
  }

  /** Pure selector: read a participant-scoped state cell value, or null. */
  selectParticipantStateValue(participantId: string, field: string): unknown {
    return this.snapshot.participantState.get(participantId)?.get(field)?.value ?? null;
  }

  /** Pure selector: ordered presence list (joinedAt ASC). */
  selectPresence(): readonly ParticipantPresence[] {
    return Array.from(this.snapshot.participants.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt,
    );
  }

  /** Pure selector: leaderboard rows for a given board name. */
  selectLeaderboard(name: string): readonly LeaderboardRow[] {
    return this.snapshot.leaderboards.get(name) ?? EMPTY_LEADERBOARD;
  }

  /** Pure selector: lifecycle snapshot. */
  selectLifecycle(): LifecycleSnapshot {
    return this.snapshot.lifecycle;
  }

  /** Pure selector: connection snapshot. */
  selectConnection(): ConnectionSnapshot {
    return this.snapshot.connection;
  }

  /** Pure selector: reactions ring buffer (newest last). */
  selectReactions(): readonly ReactionEvent[] {
    return this.snapshot.reactions;
  }

  applyReplayBegin(_msg: { from_seq: number; to_seq: number; server_ts: number }): void {
    this.replaying = true;
    const next: InternalSnapshot = { ...this.internal };
    next.connection = Object.freeze({ ...this.internal.connection, status: "replaying" });
    this.commit(next);
  }

  applyReplayEnd(msg: { last_seq: number; server_ts: number }): void {
    this.replaying = false;
    const next: InternalSnapshot = { ...this.internal };
    // last_seq is informational — keep our own lastProcessedSeq authoritative
    // (it advances inside applyStateDelta). But we ensure connection.lastSeq
    // reflects the higher of the two.
    const lastSeq = Math.max(this.internal.connection.lastSeq, msg.last_seq);
    next.connection = Object.freeze({ ...this.internal.connection, status: "live", lastSeq });
    this.commit(next);
  }

  applyPresence(msg: PresenceMessage): void {
    if (msg.seq <= this.internal.lastProcessedSeq) return; // drop-dupe
    const next: InternalSnapshot = { ...this.internal };
    const outer = mergePresence(this.internal.participants, msg.event, msg.participants);
    next.participants = outer;
    next.lastProcessedSeq = msg.seq;
    next.connection = Object.freeze({ ...this.internal.connection, lastSeq: msg.seq });
    this.commit(next);
  }

  applyLifecycle(msg: LifecycleMessage): void {
    if (msg.seq <= this.internal.lastProcessedSeq) return; // drop-dupe
    const next: InternalSnapshot = { ...this.internal };
    next.lifecycle = Object.freeze({ phase: msg.phase, since: msg.server_ts });
    next.lastProcessedSeq = msg.seq;
    next.connection = Object.freeze({ ...this.internal.connection, lastSeq: msg.seq });
    this.commit(next);
  }

  applyConnectionStatus(status: ConnectionStatus, reconnectAttempt?: number): void {
    const next: InternalSnapshot = { ...this.internal };
    next.connection = Object.freeze({
      status,
      lastSeq: this.internal.connection.lastSeq,
      reconnectAttempt: reconnectAttempt ?? this.internal.connection.reconnectAttempt,
    });
    this.commit(next);
  }

  /** True while between replay_begin and replay_end. */
  isReplaying(): boolean {
    return this.replaying;
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private commit(next: InternalSnapshot): void {
    this.internal = next;
    this.snapshot = freezeSnapshot(next);
    // Notify subscribers whose selector value changed.
    for (const sub of this.subscribers) {
      const nextValue = sub.selector(this.snapshot);
      if (!Object.is(nextValue, sub.lastValue)) {
        sub.lastValue = nextValue;
        sub.onChange(nextValue);
      }
    }
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EMPTY_LEADERBOARD: readonly LeaderboardRow[] = Object.freeze([]);

// ─── Leaderboard normalizer ─────────────────────────────────────────────────

interface RawLeaderboardRow {
  participantId?: unknown;
  participant_id?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  score?: unknown;
  rank?: unknown;
  metadata?: unknown;
}

function normalizeLeaderboardRows(raw: unknown): readonly LeaderboardRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LeaderboardRow[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i] as RawLeaderboardRow | null;
    if (r === null || typeof r !== "object") return null;
    const participantId =
      typeof r.participantId === "string"
        ? r.participantId
        : typeof r.participant_id === "string"
          ? r.participant_id
          : null;
    if (participantId === null) return null;
    const displayName =
      typeof r.displayName === "string"
        ? r.displayName
        : typeof r.display_name === "string"
          ? r.display_name
          : "";
    const score = typeof r.score === "number" ? r.score : 0;
    const rank = typeof r.rank === "number" ? r.rank : i + 1;
    out.push(
      Object.freeze({
        participantId,
        displayName,
        score,
        rank,
        metadata: r.metadata ?? undefined,
      }),
    );
  }
  return Object.freeze(out);
}

// ─── Reaction event normalizer ──────────────────────────────────────────────

interface RawReactionEvent {
  emoji?: unknown;
  fromParticipantId?: unknown;
  from_participant_id?: unknown;
  at?: unknown;
}

function normalizeReactionEvent(raw: unknown, fallbackAt: number): ReactionEvent | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as RawReactionEvent;
  if (typeof r.emoji !== "string" || r.emoji.length === 0) return null;
  const from =
    typeof r.fromParticipantId === "string"
      ? r.fromParticipantId
      : typeof r.from_participant_id === "string"
        ? r.from_participant_id
        : null;
  if (from === null) return null;
  const at = typeof r.at === "number" ? r.at : fallbackAt;
  return Object.freeze({ emoji: r.emoji, fromParticipantId: from, at });
}

// ─── Presence merge helper ─────────────────────────────────────────────────

function mergePresence(
  prev: Map<string, ParticipantPresence>,
  event: PresenceMessage["event"],
  entries: readonly PresenceEntry[],
): Map<string, ParticipantPresence> {
  if (event === "snapshot") {
    const m = new Map<string, ParticipantPresence>();
    for (const e of entries) {
      m.set(
        e.participant_id,
        Object.freeze({
          displayName: e.display_name,
          role: e.role,
          online: e.connection_state === "online",
          joinedAt: e.joined_at,
        }),
      );
    }
    return m;
  }
  const m = new Map(prev);
  if (event === "leave") {
    for (const e of entries) m.delete(e.participant_id);
    return m;
  }
  // join / update — upsert each entry.
  for (const e of entries) {
    m.set(
      e.participant_id,
      Object.freeze({
        displayName: e.display_name,
        role: e.role,
        online: e.connection_state === "online",
        joinedAt: e.joined_at,
      }),
    );
  }
  return m;
}
