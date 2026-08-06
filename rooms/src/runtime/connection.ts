// RoomConnection — the PartySocket-backed runtime wrapper.
//
// Owns:
//   - One PartySocket (or injected substitute) per (roomId, sessionToken).
//   - The `RoomStore` (source of truth for what hooks render).
//   - The `SendQueue` (mutation bookkeeping with timeouts).
//   - Reconnect scheduling using `nextDelay()` from `runtime/reconnect.ts`.
//
// The connection class is transport-agnostic via the `transportFactory` hook:
// production wires PartySocket; tests wire `FakePartySocket` from
// `test/helpers/fake-partysocket.ts`. The shape required of a transport is
// captured by `RoomTransport` below — it is the smallest viable subset of
// PartySocket we need.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (this module).
//   - Wire format §"Connection handshake" — URL builder.

import {
  ServerMessageSchema,
  type ClientMessage,
  type MutationMessage,
  type PingMessage,
  type ServerMessage,
} from "../wire-format";
import { uuidV7 } from "./ids";
import { nextDelay } from "./reconnect";
import { RoomStore, type RoomStoreSnapshot, type Selector, type Unsubscribe } from "./store";
import { SendQueue, type AckResult } from "./send-queue";
import { VisibilityCoordinator, type VisibilityCoordinatorOptions } from "./visibility";
import type { ConnectionStatus } from "../hooks/types";

// ─── Transport abstraction ────────────────────────────────────────────────

export interface RoomTransport {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
  removeEventListener?(type: string, listener: (...args: unknown[]) => void): void;
}

export interface RoomTransportFactoryArgs {
  /** Fully-built `wss://...` URL — useful for fakes and debugging. Contains
   *  the auth token and `lastEventId` query params per the wire-format. */
  readonly url: string;
  /** Worker base host (no protocol path), e.g. `rooms.forging.dev`. */
  readonly host: string;
  /** Room id — PartyKit's `room` param. */
  readonly room: string;
  /** Query parameters (token, lastEventId, proto). */
  readonly query: Record<string, string>;
}

export type RoomTransportFactory = (args: RoomTransportFactoryArgs) => RoomTransport | Promise<RoomTransport>;

// ─── Public options ───────────────────────────────────────────────────────

export type GetAuthTokenFn = () => Promise<string>;

export interface RoomConnectionOptions {
  readonly appId: string;
  readonly roomId: string;
  /** Worker base URL, e.g. `wss://rooms.forging.dev`. */
  readonly workerUrl: string;
  readonly getAuthToken: GetAuthTokenFn;
  /** Test seam — defaults to a PartySocket-backed factory in production. */
  readonly transportFactory?: RoomTransportFactory;
  /** Test seam for timers (used by SendQueue + reconnect timer). */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  /** Override mutation timeout (default 10s). */
  readonly mutationTimeoutMs?: number;
  /** Optional logger; defaults to a silent no-op. */
  readonly logger?: { warn: (msg: string, ctx?: unknown) => void; debug?: (msg: string, ctx?: unknown) => void };
  /**
   * Visibility coordinator options. Used by tests to inject fake DOM events,
   * and by SSR to suppress real document/window listeners. Defaults to the
   * production VisibilityCoordinator wired to the real `document` + `window`.
   */
  readonly visibilityOptions?: VisibilityCoordinatorOptions;
  /**
   * Override the visibility coordinator instance directly (test seam).
   * Takes precedence over `visibilityOptions`.
   */
  readonly visibilityCoordinator?: VisibilityCoordinator;
  /**
   * Milliseconds to wait for a pong after a visibility-recovery ping before
   * forcing a reconnect. Default: 2000.
   */
  readonly visibilityPingTimeoutMs?: number;
  /**
   * Endpoint for the "going offline" beacon sent on `pagehide`. When unset,
   * the beacon is skipped. The SDK POSTs a small JSON payload via
   * `navigator.sendBeacon`. Failures (return value `false`) are ignored.
   */
  readonly offlineBeaconUrl?: string;
  /** Override the sendBeacon function (test seam). */
  readonly sendBeaconFn?: (url: string, data: string) => boolean;
  /** Stable participant id for the offline beacon. */
  readonly participantId?: string;
}

const PROTO = 1;

const noopLogger = {
  warn: (_msg: string, _ctx?: unknown) => undefined,
  debug: (_msg: string, _ctx?: unknown) => undefined,
};

// ─── Default transport factory using PartySocket ──────────────────────────

// We intentionally avoid a top-level `import "partysocket"` so consumers who
// inject `transportFactory` (e.g. tests) can use the SDK without loading the
// PartySocket bundle. The import resolves lazily on first `connect()` when no
// override is provided.
type PartySocketLike = new (opts: {
  host: string;
  room: string;
  party?: string;
  query?: Record<string, string>;
  protocol?: "ws" | "wss";
}) => RoomTransport;

let cachedPartySocket: PartySocketLike | null = null;

async function loadPartySocket(): Promise<PartySocketLike> {
  if (cachedPartySocket) return cachedPartySocket;
  const mod = (await import("partysocket")) as unknown as {
    default?: PartySocketLike;
    PartySocket?: PartySocketLike;
  };
  const ctor = mod.PartySocket ?? mod.default;
  if (!ctor) {
    throw new Error("[@forging/rooms] Failed to load 'partysocket' — no default or PartySocket export.");
  }
  cachedPartySocket = ctor;
  return ctor;
}

function makeDefaultTransportFactory(): RoomTransportFactory {
  return async ({ host, room, query }) => {
    const PartySocketCtor = await loadPartySocket();
    // NOTE: RoomConnection owns its own backoff schedule via
    // `scheduleReconnect()` (see Sub-track 1.2 task 1.2.3). A future hardening
    // pass should disable PartySocket's built-in retries to avoid double
    // reconnect — see Sub-track 1.2 task 1.2.5 for the mobile/visibility
    // refinements that will land in that phase.
    return new PartySocketCtor({ host, room, query, protocol: "wss" });
  };
}

// ─── The connection class ─────────────────────────────────────────────────

export class RoomConnection {
  private readonly opts: RoomConnectionOptions;
  private readonly store: RoomStore;
  private readonly queue: SendQueue;
  private readonly transportFactory: RoomTransportFactory;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly logger: { warn: (m: string, c?: unknown) => void; debug?: (m: string, c?: unknown) => void };

  private transport: RoomTransport | null = null;
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly visibility: VisibilityCoordinator;
  private readonly visibilityPingTimeoutMs: number;
  private visibilityStarted = false;
  private pendingPingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: RoomConnectionOptions) {
    this.opts = opts;
    this.store = new RoomStore();
    this.transportFactory = opts.transportFactory ?? makeDefaultTransportFactory();
    this.setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
    this.logger = opts.logger ?? noopLogger;

    this.queue = new SendQueue({
      send: (mut) => this.rawSend(mut),
      ...(opts.mutationTimeoutMs !== undefined ? { timeoutMs: opts.mutationTimeoutMs } : {}),
      setTimeoutFn: this.setTimeoutFn,
      clearTimeoutFn: this.clearTimeoutFn,
    });

    this.visibility =
      opts.visibilityCoordinator ?? new VisibilityCoordinator(opts.visibilityOptions ?? {});
    this.visibilityPingTimeoutMs = opts.visibilityPingTimeoutMs ?? 2_000;
    this.visibility.setCallbacks({
      onVisibleRecovery: (duration) => this.onVisibilityRecovery(duration),
      onPageHide: () => this.onPageHide(),
      onPageShow: (ev) => this.onPageShow(ev.persisted),
    });
  }

  // ─── Public read API ────────────────────────────────────────────────────

  /** The underlying store, exposed for hook plumbing (task 1.2.4). */
  getStore(): RoomStore {
    return this.store;
  }

  getSnapshot(): RoomStoreSnapshot {
    return this.store.getSnapshot();
  }

  getStatus(): ConnectionStatus {
    return this.store.getSnapshot().connection.status;
  }

  subscribe<T>(selector: Selector<T>, onChange: (v: T) => void): Unsubscribe {
    return this.store.subscribe(selector, onChange);
  }

  /** App id this connection belongs to. */
  getAppId(): string {
    return this.opts.appId;
  }

  /** Room id this connection points at (also acts as the join code). */
  getRoomId(): string {
    return this.opts.roomId;
  }

  /** Stable participant id for the connected client, if known. */
  getParticipantId(): string | null {
    return this.opts.participantId ?? null;
  }

  /**
   * Lookup the role for the current participant from the presence roster.
   * Returns `null` when the participant id is unknown or not yet present.
   */
  getSelfRole(): "host" | "participant" | null {
    const pid = this.opts.participantId;
    if (!pid) return null;
    const presence = this.store.getSnapshot().participants.get(pid);
    return presence?.role ?? null;
  }

  /**
   * Send a participant-scoped reaction. Fire-and-forget — the returned
   * promise resolves on server ack but callers are not required to await.
   */
  sendReaction(emoji: string, now: () => number = Date.now): Promise<AckResult> {
    if (typeof emoji !== "string" || emoji.length === 0) {
      return Promise.reject(
        new Error("[@forging/rooms] sendReaction: `emoji` must be a non-empty string."),
      );
    }
    return this.sendMutation({
      target: "reactions.send",
      key: "send",
      patch: [{ op: "replace", path: "/event", value: { emoji, at: now() } }],
      expected_version: 0,
    });
  }

  /**
   * Send a host RPC. `name` is the action; `args` is the action-specific
   * payload. The server validates the caller's role and rejects with
   * `permission_denied` if not the host.
   */
  sendHostAction(
    name: string,
    args: Readonly<Record<string, unknown>>,
    expectedVersion = 0,
  ): Promise<AckResult> {
    if (typeof name !== "string" || name.length === 0) {
      return Promise.reject(
        new Error("[@forging/rooms] sendHostAction: `name` must be a non-empty string."),
      );
    }
    return this.sendMutation({
      target: "host.action",
      key: name,
      patch: [{ op: "replace", path: "/args", value: args }],
      expected_version: expectedVersion,
    });
  }

  /**
   * Award score on a leaderboard for the current participant. The server
   * applies an atomic `UpdateItem ADD score` per Research-1b Pitfall 5;
   * any client-side score arithmetic must NOT occur here.
   */
  sendLeaderboardAward(
    name: string,
    score: number,
    metadata?: unknown,
  ): Promise<AckResult> {
    if (typeof name !== "string" || name.length === 0) {
      return Promise.reject(
        new Error("[@forging/rooms] sendLeaderboardAward: `name` must be a non-empty string."),
      );
    }
    if (typeof score !== "number" || Number.isNaN(score)) {
      return Promise.reject(
        new Error("[@forging/rooms] sendLeaderboardAward: `score` must be a finite number."),
      );
    }
    const value: Record<string, unknown> = { score };
    if (metadata !== undefined) value.metadata = metadata;
    return this.sendMutation({
      target: "leaderboard.award",
      key: name,
      patch: [{ op: "replace", path: "/award", value }],
      expected_version: 0,
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /** Open the socket. Idempotent — safe to call from React effects. */
  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error("[@forging/rooms] RoomConnection: cannot connect after disconnect/dispose.");
    }
    if (this.transport !== null || this.connecting) {
      // Already connecting or connected.
      return;
    }
    this.connecting = true;
    try {
      this.store.applyConnectionStatus("connecting", this.reconnectAttempt);
      const args = await this.buildTransportArgs();
      const transport = await this.transportFactory(args);
      if (this.disposed) {
        try { transport.close(1000, "client_disconnect"); } catch { /* ignore */ }
        return;
      }
      this.transport = transport;
      this.attachListeners(this.transport);
      if (!this.visibilityStarted) {
        this.visibility.start();
        this.visibilityStarted = true;
      }
    } finally {
      this.connecting = false;
    }
  }

  /** Permanent close. Cancels pending mutations and stops reconnects. */
  disconnect(reason = "client_disconnect"): void {
    this.disposed = true;
    this.cancelReconnectTimer();
    this.cancelPendingPingTimer();
    if (this.visibilityStarted) {
      this.visibility.stop();
      this.visibilityStarted = false;
    }
    if (this.transport) {
      try { this.transport.close(1000, reason); } catch { /* ignore */ }
      this.transport = null;
    }
    this.queue.onNotLive();
    this.store.applyConnectionStatus("disconnected", this.reconnectAttempt);
  }

  // ─── Send API ───────────────────────────────────────────────────────────

  /**
   * Send a mutation. Returns a promise that resolves with the ack or rejects
   * (timeout, server reject, or transport error).
   *
   * If the input is missing `mutation_id`, this method assigns a fresh UUIDv7.
   */
  sendMutation(
    partial: Omit<MutationMessage, "proto" | "mutation_id" | "type"> & {
      mutation_id?: string;
    },
  ): Promise<AckResult> {
    const message: MutationMessage = {
      proto: PROTO,
      mutation_id: partial.mutation_id ?? uuidV7(),
      type: "mutation",
      target: partial.target,
      key: partial.key,
      patch: partial.patch,
      expected_version: partial.expected_version,
    };
    return this.queue.enqueue(message);
  }

  /** Send a keepalive ping. Server replies with `pong` (handled in dispatch). */
  sendPing(now: () => number = Date.now): void {
    const msg: PingMessage = { proto: PROTO, type: "ping", client_ts: now() };
    this.rawSend(msg);
  }

  // ─── Internal: URL / transport plumbing ─────────────────────────────────

  private async buildTransportArgs(): Promise<RoomTransportFactoryArgs> {
    const token = await this.opts.getAuthToken();
    const lastSeq = this.store.getSnapshot().connection.lastSeq;

    // workerUrl examples accepted: `wss://rooms.forging.dev`, `https://rooms.forging.dev`,
    // `rooms.forging.dev`. Normalize to a bare host for PartySocket and a
    // full ws(s) URL for fakes/inspection.
    const trimmed = this.opts.workerUrl.replace(/\/$/, "");
    const wsProtoMatch = trimmed.match(/^(wss?|https?):\/\//);
    const host = wsProtoMatch ? trimmed.slice(wsProtoMatch[0].length) : trimmed;
    const isInsecure = wsProtoMatch?.[1] === "ws" || wsProtoMatch?.[1] === "http";
    const wsScheme = isInsecure ? "ws" : "wss";

    const query: Record<string, string> = {
      token,
      lastEventId: String(lastSeq),
      proto: String(PROTO),
    };
    const qs = new URLSearchParams(query).toString();
    const url = `${wsScheme}://${host}/parties/main/${encodeURIComponent(this.opts.roomId)}?${qs}`;
    return Object.freeze({ url, host, room: this.opts.roomId, query });
  }

  private attachListeners(t: RoomTransport): void {
    t.addEventListener("open", () => this.onOpen());
    t.addEventListener("message", (ev) => this.onMessage(ev.data));
    t.addEventListener("close", (ev) => this.onClose(ev));
    t.addEventListener("error", (ev) => this.onError(ev));
  }

  private onOpen(): void {
    this.reconnectAttempt = 0;
    // If we have a non-zero lastSeq we expect the server to emit replay_begin
    // imminently. Until then we are "live" enough to drain the queue — but
    // the store status is set to `replaying` once replay_begin arrives.
    this.store.applyConnectionStatus("live", 0);
    this.queue.onLive();
  }

  private onMessage(data: unknown): void {
    const parsed = this.parseMessage(data);
    if (!parsed) return;
    this.dispatchServerMessage(parsed);
  }

  private parseMessage(raw: unknown): ServerMessage | null {
    let payload: unknown = raw;
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        this.logger.warn("Failed to JSON.parse server message", { err });
        return null;
      }
    }
    const result = ServerMessageSchema.safeParse(payload);
    if (!result.success) {
      this.logger.warn("Dropping malformed server message", { issues: result.error.issues });
      return null;
    }
    return result.data;
  }

  private dispatchServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "state_delta":
        this.store.applyStateDelta(msg);
        return;
      case "replay_begin":
        this.store.applyReplayBegin({
          from_seq: msg.from_seq,
          to_seq: msg.to_seq,
          server_ts: msg.server_ts,
        });
        return;
      case "replay_end":
        this.store.applyReplayEnd({ last_seq: msg.last_seq, server_ts: msg.server_ts });
        return;
      case "replay_error":
        // Server is telling us our `lastEventId` is too stale (either older
        // than the 5-min event_log retention or the catch-up window exceeded
        // the 10,000-row cap). Surfaced from worker task 1.1.9.
        //
        // Minimal SDK handling for now: log a warning so the failure is
        // visible in dev, then leave the existing state in place — the next
        // server-originated `state_delta` will overwrite stale cells via the
        // normal apply path, and the server has already advanced through the
        // gap on its own side. The full "drop-and-snapshot" fallback lands
        // in task 1.2.5 once the snapshot RPC exists.
        this.logger.warn("Server emitted replay_error; cached state may be stale", {
          reason: msg.reason,
          since_seq: msg.since_seq,
        });
        return;
      case "ack":
        this.queue.handleAck({
          mutation_id: msg.in_reply_to,
          seq: msg.seq,
          version: msg.version,
          server_ts: msg.server_ts,
        });
        return;
      case "reject":
        this.queue.handleReject({
          mutation_id: msg.in_reply_to,
          reason: msg.reason,
          message: msg.message,
        });
        return;
      case "pong":
        // Clear any visibility-recovery ping timer; the WS is alive.
        this.cancelPendingPingTimer();
        // No-op at the store layer; consumers can subscribe to ping
        // round-trip via a future API.
        return;
      case "presence":
        this.store.applyPresence(msg);
        return;
      case "lifecycle":
        this.store.applyLifecycle(msg);
        return;
      case "reaction":
        // Ephemeral reaction broadcast (task 1.1.7d). Routed to a
        // dedicated store reducer that appends to the rolling FIFO
        // window and does NOT touch `lastProcessedSeq`.
        this.store.applyReaction(msg);
        return;
      case "leaderboard_update":
        // Leaderboard updates are app-scoped and outlive any single room.
        // Integration with the leaderboard reducer is owned by the
        // sibling 1.2.7 task; here we just satisfy exhaustiveness. The
        // optional-call form keeps this resilient if the reducer hook
        // isn't wired yet — the message is silently dropped, which is
        // safe since the server will rebroadcast on the next award.
        (this.store as { applyLeaderboardUpdate?: (m: typeof msg) => void })
          .applyLeaderboardUpdate?.(msg);
        return;
      // No default — Zod discriminated union guarantees exhaustiveness.
    }
  }

  private onClose(_ev: { code: number; reason: string }): void {
    this.transport = null;
    this.queue.onNotLive();
    if (this.disposed) return;
    this.store.applyConnectionStatus("reconnecting", this.reconnectAttempt);
    this.scheduleReconnect();
  }

  private onError(ev: unknown): void {
    this.logger.warn("RoomConnection transport error", { ev });
    // PartySocket will follow up with a close event; we wait for that.
  }

  private scheduleReconnect(): void {
    this.cancelReconnectTimer();
    const delay = nextDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      // Re-open. `connect()` is idempotent and re-sets status to `connecting`.
      void this.connect().catch((err) => {
        this.logger.warn("Reconnect attempt failed", { err });
        // Schedule another try.
        this.store.applyConnectionStatus("reconnecting", this.reconnectAttempt);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rawSend(msg: ClientMessage): void {
    if (!this.transport) {
      throw new Error("[@forging/rooms] RoomConnection.rawSend: transport not open.");
    }
    this.transport.send(JSON.stringify(msg));
  }

  // ─── Visibility integration (task 1.2.10) ───────────────────────────────

  /**
   * Called by VisibilityCoordinator when the page returns to visible after a
   * hidden span exceeding the threshold. Behavior:
   *   - If status is "live": send a ping; if no pong arrives within
   *     `visibilityPingTimeoutMs` (default 2s), force-close the socket and
   *     trigger reconnect (the WS is half-open and the browser dropped it).
   *   - Otherwise: trigger reconnect immediately (no point pinging a dead WS).
   */
  private onVisibilityRecovery(hiddenDurationMs: number): void {
    if (this.disposed) return;
    this.logger.debug?.("visibility recovery", { hiddenDurationMs });
    const status = this.getStatus();
    if (status === "live" && this.transport) {
      try {
        this.sendPing();
      } catch (err: unknown) {
        this.logger.warn("visibility-recovery ping failed; forcing reconnect", { err });
        this.forceReconnectAfterVisibility();
        return;
      }
      this.cancelPendingPingTimer();
      this.pendingPingTimer = this.setTimeoutFn(() => {
        this.pendingPingTimer = null;
        if (this.disposed) return;
        this.logger.warn("visibility-recovery ping timed out; forcing reconnect");
        this.forceReconnectAfterVisibility();
      }, this.visibilityPingTimeoutMs);
      return;
    }
    // Already disconnected / reconnecting / replaying — kick a reconnect.
    this.forceReconnectAfterVisibility();
  }

  private forceReconnectAfterVisibility(): void {
    if (this.disposed) return;
    this.cancelPendingPingTimer();
    if (this.transport) {
      try { this.transport.close(4001, "visibility_recovery"); } catch { /* ignore */ }
      // onClose will null the transport and schedule reconnect.
      return;
    }
    // No transport — schedule an immediate reconnect bypassing backoff.
    this.cancelReconnectTimer();
    this.reconnectAttempt = 0;
    this.store.applyConnectionStatus("reconnecting", this.reconnectAttempt);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      void this.connect().catch((err) => {
        this.logger.warn("Visibility-triggered reconnect failed", { err });
        this.scheduleReconnect();
      });
    }, 0);
  }

  private cancelPendingPingTimer(): void {
    if (this.pendingPingTimer != null) {
      this.clearTimeoutFn(this.pendingPingTimer);
      this.pendingPingTimer = null;
    }
  }

  /**
   * Called on `pagehide`. Best-effort offline beacon — the SDK doesn't wait
   * on the result. `sendBeacon` returns `false` if the browser declined
   * (rate-limited, payload too large, no offlineBeaconUrl); we swallow it.
   */
  private onPageHide(): void {
    const url = this.opts.offlineBeaconUrl;
    if (!url) return;
    const participantId = this.opts.participantId ?? null;
    const payload = JSON.stringify({
      type: "participant_going_offline",
      participant_id: participantId,
      room_id: this.opts.roomId,
      app_id: this.opts.appId,
      ts: Date.now(),
    });
    try {
      const beacon =
        this.opts.sendBeaconFn ??
        (typeof navigator !== "undefined" &&
        typeof (navigator as { sendBeacon?: unknown }).sendBeacon === "function"
          ? (navigator as unknown as { sendBeacon: (u: string, d: string) => boolean }).sendBeacon.bind(navigator)
          : null);
      if (!beacon) return;
      beacon(url, payload);
    } catch (err: unknown) {
      this.logger.warn("offline beacon send failed", { err });
    }
  }

  /**
   * Called on `pageshow`. When `persisted === true` the page came back from
   * the bfcache and any cached WebSocket / timers are stale. Reset state and
   * reconnect from scratch.
   */
  private onPageShow(persisted: boolean): void {
    if (this.disposed) return;
    if (!persisted) return;
    this.logger.debug?.("pageshow persisted=true; full reset + reconnect");
    this.cancelReconnectTimer();
    this.cancelPendingPingTimer();
    if (this.transport) {
      try { this.transport.close(4002, "bfcache_restore"); } catch { /* ignore */ }
      this.transport = null;
    }
    this.queue.onNotLive();
    this.reconnectAttempt = 0;
    this.store.applyConnectionStatus("reconnecting", 0);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      void this.connect().catch((err) => {
        this.logger.warn("Post-bfcache reconnect failed", { err });
        this.scheduleReconnect();
      });
    }, 0);
  }
}
