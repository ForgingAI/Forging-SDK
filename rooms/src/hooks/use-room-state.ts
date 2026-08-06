// `useRoomState` + `useParticipantState` — mutation-style hooks bound to a
// `RoomDefinition`. Implements Research-1b Finding 1 (mutation-style beats
// setter-style for LLM-generated code): the recipe receives a draft of the
// CURRENT server state at fire-time, not a closure of render-time state.
//
// Wire shape:
//   - Recipe is run through Immer's `produceWithPatches` to compute a JSON
//     Patch document. The patch is rooted at `/` for whole-state mutations
//     and at `/value` for keyed mutations (so the worker can route by `key`).
//   - The mutation is enqueued via `RoomConnection.sendMutation`, which
//     returns a promise resolving on ack (rejecting on reject/timeout).
//   - Optimistic local apply: the store advances immediately and rolls back
//     on reject (the rollback is handled at the store layer via the next
//     authoritative `state_delta` broadcast).
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
// task 1.2.4.

import { useCallback, useSyncExternalStore } from "react";
import { produceWithPatches, enablePatches, type Draft } from "immer";

import type { RoomConnection } from "../runtime/connection";
import type { RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";
import type {
  ParticipantStateKeysOf,
  ParticipantStateOf,
  ParticipantStateValueAt,
  RoomDefinition,
  RoomStateOf,
  StateKeysOf,
  StateValueAt,
} from "../schema/define-room";

import type {
  HookMeta,
  Mutator,
  ReadonlyMutator,
  UseParticipantStateHook,
  UseRoomStateHook,
} from "./types";
import { buildHookMeta } from "./meta";

// Immer's `produceWithPatches` requires the patches plugin be enabled. We
// enable it lazily at module load; it's idempotent.
enablePatches();

// ─── useRoomState ──────────────────────────────────────────────────────────

export function createUseRoomState<R extends RoomDefinition>(): UseRoomStateHook<R> {
  function useRoomStateImpl(): readonly [
    RoomStateOf<R> | null,
    Mutator<RoomStateOf<R>>,
    HookMeta,
  ];
  function useRoomStateImpl<K extends StateKeysOf<R>>(
    key: K,
  ): readonly [
    StateValueAt<R, K> | null,
    Mutator<StateValueAt<R, K>>,
    HookMeta,
  ];
  function useRoomStateImpl(key?: string): unknown {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(snapshot => snapshot, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const value = computeRoomStateValue<R>(app.room, snapshot, key);
    const meta = buildHookMeta(snapshot);

    const mutate = useCallback(
      async (recipe: (draft: Draft<unknown>) => void): Promise<void> => {
        if (typeof recipe !== "function") {
          throw new Error(
            "[@forging/rooms] useRoomState: mutate expects an Immer recipe function.",
          );
        }
        if (!connection) {
          throw new Error(
            "[@forging/rooms] useRoomState: cannot mutate without a live RoomConnection.",
          );
        }
        await sendRoomMutation<R>(connection, app.room, key, recipe);
      },
      [connection, app.room, key],
    );

    return [value, mutate, meta] as const;
  }
  return useRoomStateImpl as UseRoomStateHook<R>;
}

// ─── useParticipantState ───────────────────────────────────────────────────

export function createUseParticipantState<R extends RoomDefinition>(): UseParticipantStateHook<R> {
  function useParticipantStateImpl(): readonly [
    ParticipantStateOf<R> | null,
    Mutator<ParticipantStateOf<R>>,
    HookMeta,
  ];
  function useParticipantStateImpl<K extends ParticipantStateKeysOf<R>>(
    key: K,
  ): readonly [
    ParticipantStateValueAt<R, K> | null,
    Mutator<ParticipantStateValueAt<R, K>>,
    HookMeta,
  ];
  function useParticipantStateImpl<K extends ParticipantStateKeysOf<R>>(
    key: K,
    participantId: string,
  ): readonly [
    ParticipantStateValueAt<R, K> | null,
    ReadonlyMutator,
    HookMeta,
  ];
  function useParticipantStateImpl(key?: string, participantId?: string): unknown {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(snapshot => snapshot, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const selfId = connection?.getParticipantId() ?? null;
    const effectiveId = participantId ?? selfId;
    const value = computeParticipantStateValue(snapshot, effectiveId, key);
    const meta = buildHookMeta(snapshot);

    const otherParticipant = participantId !== undefined && participantId !== selfId;

    const mutate = useCallback(
      async (recipe: (draft: Draft<unknown>) => void): Promise<void> => {
        if (otherParticipant) {
          throw new Error(
            "[@forging/rooms] useParticipantState: cannot mutate another participant's state.",
          );
        }
        if (typeof recipe !== "function") {
          throw new Error(
            "[@forging/rooms] useParticipantState: mutate expects an Immer recipe function.",
          );
        }
        if (!connection) {
          throw new Error(
            "[@forging/rooms] useParticipantState: cannot mutate without a live RoomConnection.",
          );
        }
        if (!selfId) {
          throw new Error(
            "[@forging/rooms] useParticipantState: participantId not configured on the connection.",
          );
        }
        await sendParticipantMutation(connection, selfId, key, recipe);
      },
      [connection, selfId, key, otherParticipant],
    );

    return [value, mutate, meta] as const;
  }
  return useParticipantStateImpl as UseParticipantStateHook<R>;
}

// ─── Value selectors ────────────────────────────────────────────────────────

function computeRoomStateValue<R extends RoomDefinition>(
  room: R,
  snapshot: RoomStoreSnapshot | null,
  key: string | undefined,
): unknown {
  if (snapshot === null) return null;
  if (key !== undefined) {
    return snapshot.roomState.get(key)?.value ?? null;
  }
  // No key: build the whole-state object from declared keys.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(room.state)) {
    const cell = snapshot.roomState.get(k);
    if (cell) out[k] = cell.value;
  }
  return Object.keys(out).length === 0 ? null : out;
}

function computeParticipantStateValue(
  snapshot: RoomStoreSnapshot | null,
  participantId: string | null,
  key: string | undefined,
): unknown {
  if (snapshot === null || participantId === null) return null;
  const fields = snapshot.participantState.get(participantId);
  if (!fields) return null;
  if (key !== undefined) {
    return fields.get(key)?.value ?? null;
  }
  const out: Record<string, unknown> = {};
  for (const [k, cell] of fields) out[k] = cell.value;
  return Object.keys(out).length === 0 ? null : out;
}

// ─── Send paths ────────────────────────────────────────────────────────────

async function sendRoomMutation<R extends RoomDefinition>(
  connection: RoomConnection,
  room: R,
  key: string | undefined,
  recipe: (draft: Draft<unknown>) => void,
): Promise<void> {
  const snapshot = connection.getSnapshot();
  if (key !== undefined) {
    const cell = snapshot.roomState.get(key);
    const current = cell?.value ?? null;
    const [, patches] = produceWithPatches(current as unknown, draft => {
      recipe(draft as Draft<unknown>);
    });
    const expectedVersion = cell?.version ?? 0;
    await connection.sendMutation({
      target: "state",
      key,
      patch: patches.map(toJsonPatchOp),
      expected_version: expectedVersion,
    });
    return;
  }
  // Whole-state mutate: build a draft object spanning all declared keys.
  const whole: Record<string, unknown> = {};
  let highestVersion = 0;
  for (const k of Object.keys(room.state)) {
    const cell = snapshot.roomState.get(k);
    if (cell) {
      whole[k] = cell.value;
      if (cell.version > highestVersion) highestVersion = cell.version;
    } else {
      whole[k] = null;
    }
  }
  const [, patches] = produceWithPatches(whole, draft => {
    recipe(draft as Draft<unknown>);
  });
  // Whole-state mutate is encoded as a series of per-key state mutations;
  // we send one mutation per top-level key the recipe touched. The worker
  // applies them in order.
  for (const patch of patches) {
    const path = patch.path;
    if (path.length === 0) {
      throw new Error("[@forging/rooms] useRoomState: cannot replace whole state at root.");
    }
    const stateKey = String(path[0]);
    const remainder = path.slice(1);
    const cell = snapshot.roomState.get(stateKey);
    await connection.sendMutation({
      target: "state",
      key: stateKey,
      patch: [
        {
          op: patch.op,
          path: "/" + remainder.map((seg: string | number) => String(seg)).join("/"),
          ...(patch.value !== undefined ? { value: patch.value as unknown } : {}),
        },
      ],
      expected_version: cell?.version ?? 0,
    });
  }
}

async function sendParticipantMutation(
  connection: RoomConnection,
  participantId: string,
  key: string | undefined,
  recipe: (draft: Draft<unknown>) => void,
): Promise<void> {
  const snapshot = connection.getSnapshot();
  if (key !== undefined) {
    const wireKey = `${participantId}:${key}`;
    const cell = snapshot.participantState.get(participantId)?.get(key);
    const current = cell?.value ?? null;
    const [, patches] = produceWithPatches(current as unknown, draft => {
      recipe(draft as Draft<unknown>);
    });
    await connection.sendMutation({
      target: "participantState",
      key: wireKey,
      patch: patches.map(toJsonPatchOp),
      expected_version: cell?.version ?? 0,
    });
    return;
  }
  // Whole participant state: encode per-field.
  const fields = snapshot.participantState.get(participantId);
  const whole: Record<string, unknown> = {};
  if (fields) {
    for (const [k, cell] of fields) whole[k] = cell.value;
  }
  const [, patches] = produceWithPatches(whole, draft => {
    recipe(draft as Draft<unknown>);
  });
  for (const patch of patches) {
    if (patch.path.length === 0) {
      throw new Error(
        "[@forging/rooms] useParticipantState: cannot replace whole participant state at root.",
      );
    }
    const fieldKey = String(patch.path[0]);
    const remainder = patch.path.slice(1);
    const cell = fields?.get(fieldKey);
    await connection.sendMutation({
      target: "participantState",
      key: `${participantId}:${fieldKey}`,
      patch: [
        {
          op: patch.op,
          path: "/" + remainder.map((seg: string | number) => String(seg)).join("/"),
          ...(patch.value !== undefined ? { value: patch.value as unknown } : {}),
        },
      ],
      expected_version: cell?.version ?? 0,
    });
  }
}

// ─── Immer patch → JSON Patch op conversion ─────────────────────────────────

interface ImmerPatch {
  readonly op: "add" | "remove" | "replace";
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

function toJsonPatchOp(p: ImmerPatch): {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
} {
  const path = "/" + p.path.map((seg: string | number) => String(seg)).join("/");
  if (p.op === "remove") {
    return { op: "remove", path };
  }
  return { op: p.op, path, value: p.value };
}
