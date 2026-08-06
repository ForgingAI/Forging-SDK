// Minimal in-memory PartySocket fake for `RoomConnection` tests.
//
// Implements just enough of the `RoomTransport` interface to drive the
// connection's state machine: `send`, `close`, and `addEventListener` for
// open/message/close/error events. Tests pull the fake out of a registry,
// flip the "open" toggle, push messages, simulate closes, and inspect the
// outbound `sent` buffer.

import type { RoomTransport, RoomTransportFactory } from "../../src/runtime/connection";

type Listener<T> = (ev: T) => void;

interface CloseEvent {
  code: number;
  reason: string;
}

export class FakePartySocket implements RoomTransport {
  public readonly sent: string[] = [];
  public closed = false;
  public lastCloseCode: number | null = null;
  public lastCloseReason: string | null = null;

  private openListeners: Listener<void>[] = [];
  private messageListeners: Listener<{ data: unknown }>[] = [];
  private closeListeners: Listener<CloseEvent>[] = [];
  private errorListeners: Listener<unknown>[] = [];

  send(payload: string): void {
    if (this.closed) {
      throw new Error("FakePartySocket: send after close");
    }
    this.sent.push(payload);
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    for (const l of this.closeListeners) l({ code, reason });
  }

  addEventListener(type: "open", listener: Listener<void>): void;
  addEventListener(type: "message", listener: Listener<{ data: unknown }>): void;
  addEventListener(type: "close", listener: Listener<CloseEvent>): void;
  addEventListener(type: "error", listener: Listener<unknown>): void;
  addEventListener(type: string, listener: Listener<unknown>): void {
    if (type === "open") this.openListeners.push(listener as Listener<void>);
    else if (type === "message") this.messageListeners.push(listener as Listener<{ data: unknown }>);
    else if (type === "close") this.closeListeners.push(listener as Listener<CloseEvent>);
    else if (type === "error") this.errorListeners.push(listener);
  }

  // ─── Test driver helpers ────────────────────────────────────────────────

  /** Simulate the socket open handshake completing. */
  fireOpen(): void {
    for (const l of this.openListeners) l(undefined as unknown as void);
  }

  /** Push an inbound message. `data` is normally a JSON string but `unknown` to
   *  let tests assert that the dispatcher tolerates non-string payloads. */
  fireMessage(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const l of this.messageListeners) l({ data: payload });
  }

  /** Simulate an unsolicited remote close. */
  fireClose(code = 1006, reason = "network"): void {
    if (this.closed) return;
    this.closed = true;
    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    for (const l of this.closeListeners) l({ code, reason });
  }

  fireError(err: unknown): void {
    for (const l of this.errorListeners) l(err);
  }

  /** Last outbound payload as parsed JSON, or null. */
  lastSentJson<T = unknown>(): T | null {
    const last = this.sent[this.sent.length - 1];
    if (last === undefined) return null;
    return JSON.parse(last) as T;
  }
}

/**
 * Build a transport factory backed by `FakePartySocket`. Each call to the
 * factory creates a fresh socket and pushes it onto `sockets` so tests can
 * grab the current one. The factory is sync (returns directly) so tests
 * don't have to await connect() before driving the fake.
 */
export function fakeTransportFactory(): {
  factory: RoomTransportFactory;
  sockets: FakePartySocket[];
  current: () => FakePartySocket;
} {
  const sockets: FakePartySocket[] = [];
  return {
    factory: () => {
      const s = new FakePartySocket();
      sockets.push(s);
      return s;
    },
    sockets,
    current: () => {
      const s = sockets[sockets.length - 1];
      if (!s) throw new Error("fakeTransportFactory: no socket created yet");
      return s;
    },
  };
}
