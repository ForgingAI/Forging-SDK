// Hooks tests for task 1.2.4 + 1.2.5 + 1.2.6 + 1.2.7.
//
// Uses @testing-library/react + a FakePartySocket transport to drive the
// underlying RoomConnection. Each test renders a small consumer component
// inside a <RoomAppProvider> and asserts on the hook's return value.
//
// What is NOT yet covered (because the corresponding server-side handlers
// don't exist):
//   - Real round-trip ack/reject from a worker — the FakePartySocket lets
//     us simulate ack/reject locally. When 1.1.7c/1.1.7d (leaderboard.award
//     + host.action worker handlers) land, the assertion can switch to live
//     workerd-pool integration.
//   - Reactions broadcast fan-out from the server — same caveat.

import { describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { createRoomApp } from "../src/app/create-room-app";
import { defineLeaderboard, defineRoom } from "../src/schema/index";
import { RoomAppProvider } from "../src/runtime/react-context";
import type {
  AckMessage,
  LifecycleMessage,
  MutationMessage,
  PresenceMessage,
  StateDeltaMessage,
} from "../src/wire-format";
import { z } from "zod";

import { fakeTransportFactory, FakePartySocket } from "./helpers/fake-partysocket";

// ─── Shared fixture: minimal trivia-style room ─────────────────────────────

const TriviaRoom = defineRoom({
  state: {
    phase: z.enum(["lobby", "active", "ended"]),
    currentQuestion: z.string().nullable(),
    score: z.number().int(),
  },
  participantState: {
    answer: z.string().nullable(),
  },
  leaderboards: {
    scores: defineLeaderboard({ scoring: "sum" }),
  },
  lifecycle: ["lobby", "active", "ended"] as const,
});

function makeApp(opts: { participantId?: string } = {}) {
  const { factory, current, sockets } = fakeTransportFactory();
  const app = createRoomApp({
    app_id: "trivia",
    room: TriviaRoom,
    persistence: "checkpointed",
    roomId: "room-abc",
    workerUrl: "wss://rooms.test",
    getAuthToken: async () => "tok",
    transportFactory: factory,
    ...(opts.participantId !== undefined ? { participantId: opts.participantId } : {}),
  });
  return { app, current, sockets };
}

async function openLive(
  app: ReturnType<typeof makeApp>["app"],
  current: () => FakePartySocket,
): Promise<void> {
  await act(async () => {
    await app.connect();
  });
  await act(async () => {
    current().fireOpen();
  });
}

function pushDelta(
  current: () => FakePartySocket,
  partial: Partial<StateDeltaMessage> & Pick<StateDeltaMessage, "seq" | "key" | "value">,
): void {
  const msg: StateDeltaMessage = {
    proto: 1,
    type: "state_delta",
    target: "state",
    version: partial.seq,
    server_ts: partial.seq * 10,
    ...partial,
  };
  act(() => current().fireMessage(msg));
}

function pushPresence(
  current: () => FakePartySocket,
  msg: PresenceMessage,
): void {
  act(() => current().fireMessage(msg));
}

function pushLifecycle(
  current: () => FakePartySocket,
  msg: LifecycleMessage,
): void {
  act(() => current().fireMessage(msg));
}

function pushAck(current: () => FakePartySocket, sent: MutationMessage): void {
  const ack: AckMessage = {
    proto: 1,
    type: "ack",
    in_reply_to: sent.mutation_id,
    seq: 999,
    version: 1,
    server_ts: 9990,
  };
  act(() => current().fireMessage(ack));
}

function wrap(app: ReturnType<typeof makeApp>["app"]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <RoomAppProvider app={app}>{children}</RoomAppProvider>;
  };
}

// ─── useRoomState ──────────────────────────────────────────────────────────

describe("useRoomState", () => {
  it("returns null state before any delta lands", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useRoomState("phase"), {
      wrapper: wrap(app),
    });
    expect(result.current[0]).toBeNull();
  });

  it("reflects state_delta broadcasts", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useRoomState("phase"), {
      wrapper: wrap(app),
    });
    pushDelta(current, { seq: 1, key: "phase", value: "active" });
    expect(result.current[0]).toBe("active");
  });

  it("mutate enqueues a wire-format mutation with a JSON Patch", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    pushDelta(current, { seq: 1, key: "score", value: 5 });
    const { result } = renderHook(() => app.hooks.useRoomState("score"), {
      wrapper: wrap(app),
    });
    let resolved = false;
    void result.current[1](draft => {
      // The draft is the CURRENT server snapshot (=5), not whatever closure
      // a render captured. Cast through unknown to assign on the primitive
      // draft (Immer returns the new value when the recipe returns it).
      // For primitives we instead must replace via produce returning the
      // new value; here we test object case below.
      void draft;
    }).then(() => {
      resolved = true;
    });
    // Mutation should be on the wire (no patch since recipe did nothing).
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.type).toBe("mutation");
    expect(sent?.target).toBe("state");
    expect(sent?.key).toBe("score");
    expect(sent?.expected_version).toBe(1);
    // Ack it to settle the promise.
    pushAck(current, sent!);
    await act(async () => {});
    expect(resolved).toBe(true);
  });

  it("mutate works on object-typed cells via Immer recipe", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    pushDelta(current, { seq: 1, key: "currentQuestion", value: { text: "Q1", id: "q1" } });
    const { result } = renderHook(() => app.hooks.useRoomState("currentQuestion"), {
      wrapper: wrap(app),
    });
    void result.current[1](draft => {
      (draft as { text: string }).text = "Q2";
    });
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.target).toBe("state");
    expect(sent?.key).toBe("currentQuestion");
    expect(sent?.patch).toEqual([
      { op: "replace", path: "/text", value: "Q2" },
    ]);
  });
});

// ─── useParticipantState ───────────────────────────────────────────────────

describe("useParticipantState", () => {
  it("reads the current participant's value when no participantId is given", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    pushDelta(current, {
      seq: 1,
      target: "participantState",
      key: "p1:answer",
      value: "blue",
    });
    const { result } = renderHook(
      () => app.hooks.useParticipantState("answer"),
      { wrapper: wrap(app) },
    );
    expect(result.current[0]).toBe("blue");
  });

  it("rejects mutate calls targeting another participant", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    const { result } = renderHook(
      () => app.hooks.useParticipantState("answer", "p2"),
      { wrapper: wrap(app) },
    );
    await expect(
      // The cross-participant mutate is intentionally typed as ReadonlyMutator;
      // call site asserts it rejects.
      (result.current[1] as unknown as (
        recipe: (d: unknown) => void,
      ) => Promise<void>)(() => undefined),
    ).rejects.toThrow(/another participant/);
  });
});

// ─── useRoom ───────────────────────────────────────────────────────────────

describe("useRoom", () => {
  it("returns the code, url, phase, participantCount, status", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    pushPresence(current, {
      proto: 1,
      type: "presence",
      seq: 1,
      event: "snapshot",
      server_ts: 10,
      participants: [
        {
          participant_id: "p1",
          display_name: "Alice",
          role: "host",
          connection_state: "online",
          joined_at: 100,
        },
      ],
    });
    pushLifecycle(current, {
      proto: 1,
      type: "lifecycle",
      seq: 2,
      phase: "active",
      prev_phase: "lobby",
      server_ts: 20,
    });
    const { result } = renderHook(() => app.hooks.useRoom(), {
      wrapper: wrap(app),
    });
    expect(result.current.code).toBe("room-abc");
    expect(result.current.url).toBe("wss://rooms.test");
    expect(result.current.phase).toBe("active");
    expect(result.current.participantCount).toBe(1);
    expect(result.current.status).toBe("live");
  });
});

// ─── useRoomPresence ───────────────────────────────────────────────────────

describe("useRoomPresence", () => {
  it("reflects join/leave events ordered by joinedAt ASC", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    pushPresence(current, {
      proto: 1,
      type: "presence",
      seq: 1,
      event: "snapshot",
      server_ts: 10,
      participants: [
        {
          participant_id: "p2",
          display_name: "Bob",
          role: "participant",
          connection_state: "online",
          joined_at: 200,
        },
        {
          participant_id: "p1",
          display_name: "Alice",
          role: "host",
          connection_state: "online",
          joined_at: 100,
        },
      ],
    });
    const { result } = renderHook(() => app.hooks.useRoomPresence(), {
      wrapper: wrap(app),
    });
    expect(result.current.map(p => p.participantId)).toEqual(["p1", "p2"]);
    expect(result.current[0]?.displayName).toBe("Alice");
    expect(result.current[0]?.role).toBe("host");
  });
});

// ─── useHostControls ───────────────────────────────────────────────────────

describe("useHostControls", () => {
  it("returns null for participants", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    pushPresence(current, {
      proto: 1,
      type: "presence",
      seq: 1,
      event: "snapshot",
      server_ts: 10,
      participants: [
        {
          participant_id: "p1",
          display_name: "Alice",
          role: "participant",
          connection_state: "online",
          joined_at: 100,
        },
      ],
    });
    const { result } = renderHook(() => app.hooks.useHostControls(), {
      wrapper: wrap(app),
    });
    expect(result.current).toBeNull();
  });

  it("returns the full action set for hosts", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    pushPresence(current, {
      proto: 1,
      type: "presence",
      seq: 1,
      event: "snapshot",
      server_ts: 10,
      participants: [
        {
          participant_id: "p1",
          display_name: "Alice",
          role: "host",
          connection_state: "online",
          joined_at: 100,
        },
      ],
    });
    const { result } = renderHook(() => app.hooks.useHostControls(), {
      wrapper: wrap(app),
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.setPhase).toBe("function");
    expect(typeof result.current?.kick).toBe("function");
    expect(typeof result.current?.endRoom).toBe("function");
  });

  it("setPhase emits a host.action mutation with `setPhase` key", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    pushPresence(current, {
      proto: 1,
      type: "presence",
      seq: 1,
      event: "snapshot",
      server_ts: 10,
      participants: [
        {
          participant_id: "p1",
          display_name: "Alice",
          role: "host",
          connection_state: "online",
          joined_at: 100,
        },
      ],
    });
    const { result } = renderHook(() => app.hooks.useHostControls(), {
      wrapper: wrap(app),
    });
    void result.current?.setPhase("active");
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.target).toBe("host.action");
    expect(sent?.key).toBe("setPhase");
    expect(sent?.patch).toEqual([
      { op: "replace", path: "/args", value: { phase: "active" } },
    ]);
  });
});

// ─── useLeaderboard ────────────────────────────────────────────────────────

describe("useLeaderboard", () => {
  it("submit() sends a leaderboard.award mutation with score + metadata", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useLeaderboard("scores"), {
      wrapper: wrap(app),
    });
    void result.current.submit(10);
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.target).toBe("leaderboard.award");
    expect(sent?.key).toBe("scores");
    expect(sent?.patch).toEqual([
      { op: "replace", path: "/award", value: { score: 10 } },
    ]);
  });

  it("rows arrive via state_delta with target leaderboard.award", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useLeaderboard("scores"), {
      wrapper: wrap(app),
    });
    pushDelta(current, {
      seq: 1,
      target: "leaderboard.award",
      key: "scores",
      value: [
        { participantId: "p1", displayName: "Alice", score: 30, rank: 1 },
        { participantId: "p2", displayName: "Bob", score: 20, rank: 2 },
      ],
    });
    expect(result.current.entries.map(e => e.participantId)).toEqual(["p1", "p2"]);
    expect(result.current.entries[0]?.score).toBe(30);
  });
});

// ─── useReactions ──────────────────────────────────────────────────────────

describe("useReactions", () => {
  it("send() emits a reactions.send mutation with emoji + ts", async () => {
    const { app, current } = makeApp({ participantId: "p1" });
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useReactions(), {
      wrapper: wrap(app),
    });
    void result.current.send("🔥");
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.target).toBe("reactions.send");
    expect(sent?.key).toBe("send");
    expect(Array.isArray(sent?.patch)).toBe(true);
    const op = sent?.patch[0];
    expect(op?.op).toBe("replace");
    expect(op?.path).toBe("/event");
    const value = op?.value as { emoji?: string; at?: number };
    expect(value?.emoji).toBe("🔥");
    expect(typeof value?.at).toBe("number");
  });

  it("recent reflects inbound reactions ring buffer (FIFO window)", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useReactions(), {
      wrapper: wrap(app),
    });
    for (let i = 0; i < 3; i += 1) {
      pushDelta(current, {
        seq: i + 1,
        target: "reactions.send",
        key: "send",
        value: { emoji: "👍", fromParticipantId: "p1", at: i },
      });
    }
    expect(result.current.recent.map(r => r.at)).toEqual([0, 1, 2]);
  });
});

// ─── useRoomLifecycle ──────────────────────────────────────────────────────

describe("useRoomLifecycle", () => {
  it("returns the current phase + allowed phases + transitionTo", async () => {
    const { app, current } = makeApp();
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useRoomLifecycle(), {
      wrapper: wrap(app),
    });
    expect(result.current.phase).toBe("lobby");
    expect(result.current.allowed).toEqual(["lobby", "active", "ended"]);
    expect(typeof result.current.transitionTo).toBe("function");
  });

  it("transitionTo enqueues a setPhase host.action", async () => {
    const { app, current } = makeApp({ participantId: "host-id" });
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useRoomLifecycle(), {
      wrapper: wrap(app),
    });
    void result.current.transitionTo("active");
    const sent = current().lastSentJson<MutationMessage>();
    expect(sent?.target).toBe("host.action");
    expect(sent?.key).toBe("setPhase");
  });

  it("transitionTo rejects when the phase is not declared", async () => {
    const { app, current } = makeApp({ participantId: "host-id" });
    await openLive(app, current);
    const { result } = renderHook(() => app.hooks.useRoomLifecycle(), {
      wrapper: wrap(app),
    });
    await expect(
      result.current.transitionTo("garbage" as unknown as "active"),
    ).rejects.toThrow(/not declared/);
  });
});

// ─── Smoke: provider gates ─────────────────────────────────────────────────

describe("RoomAppProvider", () => {
  it("renders children when wired", () => {
    const { app } = makeApp();
    const { getByText } = render(
      <RoomAppProvider app={app}>
        <div>hello</div>
      </RoomAppProvider>,
    );
    expect(getByText("hello")).toBeTruthy();
  });
});
