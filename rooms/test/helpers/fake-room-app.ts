// Test helper: build a fake `RoomApp` with mocked hooks so component tests
// don't need a real WebSocket transport.
//
// The shape mirrors `BoundHooks<R>` from `src/hooks/index.ts` but every hook
// is a Vitest mock that returns a caller-provided value. Tests pass the
// returned `app` to a `<RoomAppProvider>` or to `<JoinFlow app={...} />`.

import { vi, type Mock } from "vitest";

import type { RoomApp } from "../../src/app/create-room-app";
import type { BoundHooks } from "../../src/hooks/index";
import type {
  HostControlActions,
  PresenceParticipant,
  RoomMeta,
  UseLeaderboardResult,
  UseReactionsResult,
  UseRoomLifecycleResult,
} from "../../src/hooks/types";
import type { LifecyclePhase, RoomDefinition } from "../../src/schema/define-room";

export interface FakeRoomAppState {
  readonly roomMeta?: Partial<RoomMeta<RoomDefinition>>;
  readonly presence?: readonly PresenceParticipant[];
  readonly hostControls?: HostControlActions<RoomDefinition> | null;
  readonly leaderboard?: UseLeaderboardResult<unknown>;
  readonly reactions?: UseReactionsResult;
  readonly lifecycle?: UseRoomLifecycleResult<RoomDefinition>;
}

export interface FakeRoomApp {
  readonly app: RoomApp<RoomDefinition>;
  readonly mocks: {
    readonly connect: Mock;
    readonly disconnect: Mock;
    readonly useRoom: Mock;
    readonly useRoomPresence: Mock;
    readonly useHostControls: Mock;
    readonly useLeaderboard: Mock;
    readonly useReactions: Mock;
    readonly useRoomLifecycle: Mock;
  };
}

export function makeFakeRoomApp(state: FakeRoomAppState = {}): FakeRoomApp {
  const roomMeta: RoomMeta<RoomDefinition> = {
    code: "PLUM-FROG",
    url: "https://example.test/r/PLUM-FROG",
    phase: "lobby" as LifecyclePhase,
    participantCount: 0,
    status: "live",
    ...state.roomMeta,
  };
  const lifecycle: UseRoomLifecycleResult<RoomDefinition> = state.lifecycle ?? {
    phase: roomMeta.phase,
    transitionTo: vi.fn().mockResolvedValue(undefined),
    allowed: ["lobby", "active"] as readonly LifecyclePhase[],
  };

  const useRoom = vi.fn(() => roomMeta);
  const useRoomPresence = vi.fn(() => state.presence ?? []);
  const useHostControls = vi.fn(() => state.hostControls ?? null);
  const useLeaderboard = vi.fn(
    () =>
      state.leaderboard ?? {
        entries: [],
        status: "live",
        submit: vi.fn().mockResolvedValue(undefined),
      },
  );
  const useReactions = vi.fn(
    () =>
      state.reactions ?? {
        send: vi.fn().mockResolvedValue(undefined),
        recent: [],
      },
  );
  const useRoomLifecycle = vi.fn(() => lifecycle);

  // Stubs for the hooks we don't drive in tests yet — useRoomState etc.
  const throwStub = (name: string) => () => {
    throw new Error(`fake-room-app: ${name} not stubbed`);
  };

  const hooks: BoundHooks<RoomDefinition> = Object.freeze({
    useRoomState: throwStub("useRoomState") as unknown as BoundHooks<RoomDefinition>["useRoomState"],
    useParticipantState: throwStub("useParticipantState") as unknown as BoundHooks<RoomDefinition>["useParticipantState"],
    useLeaderboard: useLeaderboard as unknown as BoundHooks<RoomDefinition>["useLeaderboard"],
    useHostControls: useHostControls as unknown as BoundHooks<RoomDefinition>["useHostControls"],
    useRoom: useRoom as unknown as BoundHooks<RoomDefinition>["useRoom"],
    useRoomPresence: useRoomPresence as unknown as BoundHooks<RoomDefinition>["useRoomPresence"],
    useReactions: useReactions as unknown as BoundHooks<RoomDefinition>["useReactions"],
    useRoomLifecycle: useRoomLifecycle as unknown as BoundHooks<RoomDefinition>["useRoomLifecycle"],
  });

  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn();

  const app: RoomApp<RoomDefinition> = Object.freeze({
    app_id: "test-app",
    room: { __brand: "ForgingRoomDefinition" } as unknown as RoomDefinition,
    persistence: "ephemeral",
    workerUrl: "wss://test",
    hooks,
    connection: null,
    connect,
    disconnect,
  });

  return {
    app,
    mocks: {
      connect,
      disconnect,
      useRoom,
      useRoomPresence,
      useHostControls,
      useLeaderboard,
      useReactions,
      useRoomLifecycle,
    },
  };
}
