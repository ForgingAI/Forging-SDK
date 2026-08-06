// Outbound mutation queue + pending-ack bookkeeping.
//
// Lifecycle:
//   1. Caller invokes `enqueue(mut)` which:
//      a. Creates an entry with a deferred Promise<AckResult>.
//      b. If the transport is `live`, immediately invokes `send(mut)`.
//         Otherwise the entry sits in `queued` until `onLive()` drains.
//      c. Starts a 10s rejection timer keyed by mutation_id.
//   2. Server replies with `ack` → `handleAck` resolves the deferred.
//   3. Server replies with `reject` → `handleReject` rejects the deferred.
//   4. If neither fires within 10s → timer rejects with a timeout reason.
//
// The queue is NOT responsible for actually applying patches to the store.
// The store reacts to `state_delta` broadcasts that arrive after an `ack`.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (this module).
//   - Sub-track 1.2 task 1.2.4 (consumes the `ack`/`reject` shape).

import type { MutationMessage, RejectMessage } from "../wire-format";

/** Result handed back when a mutation is acknowledged by the server. */
export interface AckResult {
  readonly mutation_id: string;
  readonly seq: number;
  readonly version: number;
  readonly server_ts: number;
}

/** Reason a mutation was rejected — server `reject` codes plus client-side. */
export type RejectReason = RejectMessage["reason"] | "timeout" | "cancelled";

/** Error thrown when a mutation is rejected. */
export class MutationRejectedError extends Error {
  public readonly mutation_id: string;
  public readonly reason: RejectReason;
  public readonly serverMessage: string | null;

  constructor(mutation_id: string, reason: RejectReason, serverMessage: string | null) {
    super(`[@forging/rooms] mutation ${mutation_id} rejected: ${reason}${serverMessage ? ` — ${serverMessage}` : ""}`);
    this.name = "MutationRejectedError";
    this.mutation_id = mutation_id;
    this.reason = reason;
    this.serverMessage = serverMessage;
  }
}

interface PendingEntry {
  readonly mutation: MutationMessage;
  readonly resolve: (r: AckResult) => void;
  readonly reject: (e: MutationRejectedError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Has been sent to the transport. False while in the pre-live queue. */
  sent: boolean;
}

/** Injected send function — called when an entry is dispatched to the wire. */
export type SendFn = (mut: MutationMessage) => void;

/** Default per-mutation timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SendQueueOptions {
  readonly send: SendFn;
  readonly timeoutMs?: number;
  /** Injectable for tests. Defaults to global `setTimeout`/`clearTimeout`. */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

export class SendQueue {
  private readonly send: SendFn;
  private readonly timeoutMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  /** Order-preserving queue of mutations awaiting `onLive()`. */
  private readonly queued: PendingEntry[] = [];
  /** mutation_id → pending entry (sent or queued). */
  private readonly pending: Map<string, PendingEntry> = new Map();
  /** True once `onLive()` has been called at least once and we are draining. */
  private live = false;

  constructor(opts: SendQueueOptions) {
    this.send = opts.send;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  }

  /** Add a mutation to the queue. Resolves when the server acks/rejects. */
  enqueue(mutation: MutationMessage): Promise<AckResult> {
    return new Promise<AckResult>((resolve, reject) => {
      const entry: PendingEntry = {
        mutation,
        resolve,
        reject,
        timer: null,
        sent: false,
      };
      this.pending.set(mutation.mutation_id, entry);

      if (this.live) {
        this.dispatch(entry);
      } else {
        this.queued.push(entry);
      }
    });
  }

  /** Mark transport live; drain any queued entries in FIFO order. */
  onLive(): void {
    this.live = true;
    while (this.queued.length > 0) {
      const entry = this.queued.shift();
      if (entry) this.dispatch(entry);
    }
  }

  /** Mark transport not live. Newly enqueued items queue rather than send. */
  onNotLive(): void {
    this.live = false;
  }

  /** Resolve a pending mutation by id. No-op if id unknown (e.g. already timed out). */
  handleAck(ack: { mutation_id: string; seq: number; version: number; server_ts: number }): void {
    const entry = this.pending.get(ack.mutation_id);
    if (!entry) return;
    this.clearTimer(entry);
    this.pending.delete(ack.mutation_id);
    entry.resolve({
      mutation_id: ack.mutation_id,
      seq: ack.seq,
      version: ack.version,
      server_ts: ack.server_ts,
    });
  }

  /** Reject a pending mutation by id. No-op if id unknown. */
  handleReject(rej: { mutation_id: string; reason: RejectMessage["reason"]; message: string }): void {
    const entry = this.pending.get(rej.mutation_id);
    if (!entry) return;
    this.clearTimer(entry);
    this.pending.delete(rej.mutation_id);
    entry.reject(new MutationRejectedError(rej.mutation_id, rej.reason, rej.message));
  }

  /** Cancel a pending mutation (timeout or programmatic). Surfaces as rejection. */
  cancel(mutation_id: string, reason: RejectReason = "cancelled"): void {
    const entry = this.pending.get(mutation_id);
    if (!entry) return;
    this.clearTimer(entry);
    this.pending.delete(mutation_id);
    // Remove from queued if it hasn't been sent yet.
    const idx = this.queued.indexOf(entry);
    if (idx >= 0) this.queued.splice(idx, 1);
    entry.reject(new MutationRejectedError(mutation_id, reason, null));
  }

  /** For debugging/tests: number of pending mutations. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** For debugging/tests: number of mutations queued waiting for live. */
  get queuedCount(): number {
    return this.queued.length;
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private dispatch(entry: PendingEntry): void {
    entry.sent = true;
    entry.timer = this.setTimeoutFn(() => {
      // Timeout fires only if neither ack nor reject arrived.
      if (this.pending.has(entry.mutation.mutation_id)) {
        this.cancel(entry.mutation.mutation_id, "timeout");
      }
    }, this.timeoutMs);
    try {
      this.send(entry.mutation);
    } catch (err) {
      // Send threw synchronously (e.g. socket closed mid-dispatch). Surface
      // as a server_error-style rejection so callers learn promptly.
      this.clearTimer(entry);
      this.pending.delete(entry.mutation.mutation_id);
      const msg = err instanceof Error ? err.message : String(err);
      entry.reject(
        new MutationRejectedError(entry.mutation.mutation_id, "server_error", msg),
      );
    }
  }

  private clearTimer(entry: PendingEntry): void {
    if (entry.timer != null) {
      this.clearTimeoutFn(entry.timer);
      entry.timer = null;
    }
  }
}
