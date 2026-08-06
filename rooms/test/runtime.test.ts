// Runtime tests for task 1.2.3 — RoomConnection, RoomStore, SendQueue,
// reconnect backoff, and UUIDv7.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   Sub-track 1.2 task 1.2.3 Acceptance section.

import { describe, expect, it, vi } from "vitest";

import { nextDelay, RECONNECT_CONSTANTS } from "../src/runtime/reconnect";
import { uuidV7 } from "../src/runtime/ids";
import { RoomStore } from "../src/runtime/store";
import { SendQueue, MutationRejectedError } from "../src/runtime/send-queue";
import { RoomConnection } from "../src/runtime/connection";
import { fakeTransportFactory } from "./helpers/fake-partysocket";
import type { MutationMessage, ServerMessage, StateDeltaMessage } from "../src/wire-format";

// ─── Test fixture helpers ──────────────────────────────────────────────────

function delta(seq: number, key: string, value: unknown, version = seq): StateDeltaMessage {
  return {
    proto: 1, type: "state_delta", seq, target: "state",
    key, value, version, server_ts: seq * 10,
  };
}

function mut(id: string, key = "k"): MutationMessage {
  return {
    proto: 1, type: "mutation", mutation_id: id, target: "state",
    key, patch: [], expected_version: 0,
  };
}

// ─── reconnect backoff ─────────────────────────────────────────────────────

describe("nextDelay", () => {
  it("produces the expected curve with rand=0 (no jitter)", () => {
    const r = () => 0;
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((a) => nextDelay(a, r))).toEqual([
      250, 500, 1000, 2000, 5000, 10000, 30000, 30000,
    ]);
  });

  it("caps at MAX_DELAY_MS even with max jitter", () => {
    const r = () => 1;
    for (let i = 0; i < 20; i += 1) {
      expect(nextDelay(i, r)).toBeLessThanOrEqual(RECONNECT_CONSTANTS.MAX_DELAY_MS);
    }
  });

  it("adds at most 25% jitter on top of the base", () => {
    const r = () => 1;
    expect(nextDelay(0, r)).toBe(Math.floor(250 * 1.25));
    expect(nextDelay(1, r)).toBe(Math.floor(500 * 1.25));
  });

  it("rejects negative attempts", () => {
    expect(() => nextDelay(-1)).toThrow();
  });
});

// ─── uuidV7 ────────────────────────────────────────────────────────────────

describe("uuidV7", () => {
  it("emits canonical hyphenated form matching RFC4122 v7", () => {
    expect(uuidV7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("encodes the timestamp in the high 48 bits", () => {
    const fixed = 1_700_000_000_000;
    const id = uuidV7(() => fixed, () => new Uint8Array(10));
    const tsHex = fixed.toString(16).padStart(12, "0");
    expect(id.replace(/-/g, "").slice(0, 12)).toBe(tsHex);
  });

  it("has stable shape and version nibble", () => {
    for (let i = 0; i < 10; i += 1) {
      const id = uuidV7();
      expect(id.length).toBe(36);
      expect(id[14]).toBe("7");
    }
  });
});

// ─── RoomStore ─────────────────────────────────────────────────────────────

describe("RoomStore", () => {
  it("starts with a frozen idle snapshot", () => {
    const s = new RoomStore().getSnapshot();
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.connection.status).toBe("idle");
    expect(s.lastProcessedSeq).toBe(0);
  });

  it("applies state_delta and bumps lastProcessedSeq", () => {
    const store = new RoomStore();
    store.applyStateDelta(delta(5, "phase", "active"));
    const snap = store.getSnapshot();
    expect(snap.roomState.get("phase")?.value).toBe("active");
    expect(snap.lastProcessedSeq).toBe(5);
    expect(snap.connection.lastSeq).toBe(5);
  });

  it("drops state_delta with seq <= lastProcessedSeq", () => {
    const store = new RoomStore();
    store.applyStateDelta(delta(5, "phase", "active"));
    store.applyStateDelta(delta(5, "phase", "DUPE"));
    store.applyStateDelta(delta(3, "phase", "OLD"));
    expect(store.getSnapshot().roomState.get("phase")?.value).toBe("active");
    expect(store.getSnapshot().lastProcessedSeq).toBe(5);
  });

  it("fires subscribers only when selector value changes", () => {
    const store = new RoomStore();
    const seen: unknown[] = [];
    store.subscribe(
      (s) => s.roomState.get("phase")?.value,
      (v) => seen.push(v),
    );
    store.applyStateDelta(delta(1, "phase", "lobby"));
    store.applyStateDelta(delta(2, "phase", "active"));
    store.applyStateDelta(delta(3, "currentQuestion", "Q1"));
    expect(seen).toEqual(["lobby", "active"]);
  });

  it("unsubscribe stops further notifications", () => {
    const store = new RoomStore();
    const cb = vi.fn();
    const unsub = store.subscribe((s) => s.lifecycle.phase, cb);
    store.applyLifecycle({
      proto: 1, type: "lifecycle", seq: 1,
      phase: "active", prev_phase: "lobby", server_ts: 1,
    });
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    store.applyLifecycle({
      proto: 1, type: "lifecycle", seq: 2,
      phase: "ended", prev_phase: "active", server_ts: 2,
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("advances replay status across begin → end", () => {
    const store = new RoomStore();
    store.applyReplayBegin({ from_seq: 0, to_seq: 10, server_ts: 1 });
    expect(store.isReplaying()).toBe(true);
    expect(store.getSnapshot().connection.status).toBe("replaying");
    store.applyReplayEnd({ last_seq: 10, server_ts: 2 });
    expect(store.isReplaying()).toBe(false);
    expect(store.getSnapshot().connection.status).toBe("live");
  });

  it("getCurrentState mirrors getSnapshot", () => {
    const store = new RoomStore();
    expect(store.getCurrentState()).toBe(store.getSnapshot());
  });
});

// ─── SendQueue ─────────────────────────────────────────────────────────────

describe("SendQueue", () => {
  it("queues before live, drains FIFO on live", () => {
    const sent: string[] = [];
    const q = new SendQueue({ send: (m) => sent.push(m.mutation_id) });
    void q.enqueue(mut("a"));
    void q.enqueue(mut("b"));
    expect(sent).toEqual([]);
    expect(q.queuedCount).toBe(2);
    q.onLive();
    expect(sent).toEqual(["a", "b"]);
    expect(q.queuedCount).toBe(0);
  });

  it("resolves on ack, rejects on reject", async () => {
    const q = new SendQueue({ send: () => undefined });
    q.onLive();
    const a = q.enqueue(mut("a"));
    const b = q.enqueue(mut("b"));
    q.handleAck({ mutation_id: "a", seq: 1, version: 1, server_ts: 1 });
    q.handleReject({ mutation_id: "b", reason: "version_conflict", message: "old" });
    await expect(a).resolves.toMatchObject({ mutation_id: "a", seq: 1 });
    await expect(b).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("times out after 10s default", async () => {
    vi.useFakeTimers();
    try {
      const q = new SendQueue({ send: () => undefined });
      q.onLive();
      const settled = q.enqueue(mut("a")).then(
        () => "resolved",
        (e: unknown) => (e instanceof MutationRejectedError ? e.reason : "other"),
      );
      vi.advanceTimersByTime(10_001);
      await expect(settled).resolves.toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("synchronous send error rejects with server_error reason", async () => {
    const q = new SendQueue({ send: () => { throw new Error("boom"); } });
    q.onLive();
    await expect(q.enqueue(mut("a"))).rejects.toMatchObject({ reason: "server_error" });
  });
});

// ─── RoomConnection ────────────────────────────────────────────────────────

describe("RoomConnection", () => {
  function makeConn() {
    const { factory, sockets, current } = fakeTransportFactory();
    const conn = new RoomConnection({
      appId: "test-app",
      roomId: "room-123",
      workerUrl: "wss://rooms.test",
      getAuthToken: async () => "tok",
      transportFactory: factory,
    });
    return { conn, sockets, current };
  }

  it("transitions idle → connecting → live on open", async () => {
    const { conn, current } = makeConn();
    expect(conn.getStatus()).toBe("idle");
    await conn.connect();
    expect(conn.getStatus()).toBe("connecting");
    current().fireOpen();
    expect(conn.getStatus()).toBe("live");
  });

  it("builds URL with token, lastEventId, and proto", async () => {
    let captured = "";
    const { factory } = fakeTransportFactory();
    const conn = new RoomConnection({
      appId: "a",
      roomId: "room-abc",
      workerUrl: "wss://rooms.example.com",
      getAuthToken: async () => "JWT-XYZ",
      transportFactory: (args) => {
        captured = args.url;
        return factory(args);
      },
    });
    await conn.connect();
    expect(captured).toContain("wss://rooms.example.com/parties/main/room-abc");
    expect(captured).toContain("token=JWT-XYZ");
    expect(captured).toContain("lastEventId=0");
    expect(captured).toContain("proto=1");
  });

  it("dispatches valid state_delta into the store", async () => {
    const { conn, current } = makeConn();
    await conn.connect();
    current().fireOpen();
    current().fireMessage(delta(1, "phase", "active") satisfies ServerMessage);
    expect(conn.getSnapshot().roomState.get("phase")?.value).toBe("active");
  });

  it("drops malformed server messages without crashing", async () => {
    const warn = vi.fn();
    const { factory, current } = fakeTransportFactory();
    const conn = new RoomConnection({
      appId: "a", roomId: "r", workerUrl: "wss://x",
      getAuthToken: async () => "t",
      transportFactory: factory,
      logger: { warn },
    });
    await conn.connect();
    current().fireOpen();
    current().fireMessage("{not json");
    current().fireMessage({ foo: "bar" });
    expect(warn).toHaveBeenCalled();
    expect(conn.getStatus()).toBe("live");
  });

  it("drops duplicate seq during replay", async () => {
    const { conn, current } = makeConn();
    await conn.connect();
    current().fireOpen();
    current().fireMessage(delta(5, "phase", "first"));
    current().fireMessage({
      proto: 1, type: "replay_begin", from_seq: 0, to_seq: 5, server_ts: 50,
    });
    current().fireMessage(delta(5, "phase", "DUPE"));
    current().fireMessage({
      proto: 1, type: "replay_end", last_seq: 5, server_ts: 60,
    });
    expect(conn.getSnapshot().roomState.get("phase")?.value).toBe("first");
  });

  it("on close, transitions to reconnecting and schedules a reconnect", async () => {
    vi.useFakeTimers();
    try {
      const { factory, sockets } = fakeTransportFactory();
      const conn = new RoomConnection({
        appId: "a", roomId: "r", workerUrl: "wss://x",
        getAuthToken: async () => "t", transportFactory: factory,
      });
      await conn.connect();
      sockets[0]!.fireOpen();
      sockets[0]!.fireClose(1006, "network");
      expect(conn.getStatus()).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(400);
      expect(sockets.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("send queue blocks before live, drains after, resolves on ack", async () => {
    const { conn, current } = makeConn();
    await conn.connect();
    const ackPromise = conn.sendMutation({
      target: "state", key: "phase", patch: [], expected_version: 0,
    });
    expect(current().sent.length).toBe(0);
    current().fireOpen();
    expect(current().sent.length).toBe(1);
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.type).toBe("mutation");
    current().fireMessage({
      proto: 1, type: "ack", in_reply_to: sent!.mutation_id,
      seq: 1, version: 1, server_ts: 1,
    });
    await expect(ackPromise).resolves.toMatchObject({ seq: 1, version: 1 });
  });

  it("mutation timeout rejects after 10s", async () => {
    vi.useFakeTimers();
    try {
      const { conn, current } = makeConn();
      await conn.connect();
      current().fireOpen();
      const settled = conn.sendMutation({
        target: "state", key: "phase", patch: [], expected_version: 0,
      }).then(
        () => "resolved",
        (e: unknown) => (e instanceof MutationRejectedError ? e.reason : "other"),
      );
      await vi.advanceTimersByTimeAsync(10_001);
      await expect(settled).resolves.toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("replay state machine: begin → events → end transitions correctly", async () => {
    const { conn, current } = makeConn();
    await conn.connect();
    current().fireOpen();
    expect(conn.getStatus()).toBe("live");
    current().fireMessage({
      proto: 1, type: "replay_begin", from_seq: 0, to_seq: 3, server_ts: 1,
    });
    expect(conn.getStatus()).toBe("replaying");
    current().fireMessage(delta(1, "phase", "a"));
    current().fireMessage(delta(2, "phase", "b"));
    current().fireMessage(delta(3, "phase", "c"));
    current().fireMessage({
      proto: 1, type: "replay_end", last_seq: 3, server_ts: 5,
    });
    expect(conn.getStatus()).toBe("live");
    expect(conn.getSnapshot().roomState.get("phase")?.value).toBe("c");
    expect(conn.getSnapshot().lastProcessedSeq).toBe(3);
  });

  it("disconnect cancels reconnects and sets status disconnected", async () => {
    const { conn, current } = makeConn();
    await conn.connect();
    current().fireOpen();
    conn.disconnect();
    expect(conn.getStatus()).toBe("disconnected");
  });
});
