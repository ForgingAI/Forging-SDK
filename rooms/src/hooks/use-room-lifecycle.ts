// `useRoomLifecycle` — reactive lifecycle phase + transition shortcut.
//
// Returns `{phase, transitionTo, allowed}` where:
//   - `phase` is the current authoritative phase (defaults to the schema's
//     first declared phase before any lifecycle broadcast).
//   - `transitionTo(p)` enqueues a `host.action` mutation with key `setPhase`.
//     The server validates that the caller is host; non-hosts get a
//     `permission_denied` reject.
//   - `allowed` is the full list of declared phases from the schema.

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";
import type {
  LifecycleOf,
  LifecyclePhase,
  RoomDefinition,
} from "../schema/define-room";

import type {
  UseRoomLifecycleHook,
  UseRoomLifecycleResult,
} from "./types";

export function createUseRoomLifecycle<R extends RoomDefinition>(): UseRoomLifecycleHook<R> {
  return function useRoomLifecycle(): UseRoomLifecycleResult<R> {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;
    const fallbackPhase = (app.room.lifecycle[0] ?? "lobby") as LifecyclePhase;
    const allowed = useMemo<readonly LifecycleOf<R>[]>(
      () => Object.freeze(app.room.lifecycle.slice() as LifecyclePhase[]) as readonly LifecycleOf<R>[],
      [app.room],
    );

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(s => s.lifecycle, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const phase = (snapshot?.lifecycle.phase ?? fallbackPhase) as LifecycleOf<R>;

    const transitionTo = useCallback(
      async (next: LifecycleOf<R>): Promise<void> => {
        if (!connection) {
          throw new Error(
            "[@forging/rooms] useRoomLifecycle: cannot transition without a live RoomConnection.",
          );
        }
        if (!allowed.includes(next)) {
          throw new Error(
            `[@forging/rooms] useRoomLifecycle: phase "${String(next)}" is not declared on the room schema.`,
          );
        }
        await connection.sendHostAction("setPhase", { phase: next });
      },
      [connection, allowed],
    );

    return Object.freeze({ phase, transitionTo, allowed });
  };
}
