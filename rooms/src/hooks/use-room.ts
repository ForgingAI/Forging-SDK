// `useRoom` — read-only metadata about the active room.
//
// Returns the room code (== roomId), the worker URL, the current lifecycle
// phase, the participant count, and the connection status. Subscribes to
// the store so phase / count / status changes re-render automatically.

import { useCallback, useSyncExternalStore } from "react";

import type { RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";
import type {
  LifecycleOf,
  LifecyclePhase,
  RoomDefinition,
} from "../schema/define-room";

import type { ConnectionStatus, RoomMeta, UseRoomHook } from "./types";

export function createUseRoom<R extends RoomDefinition>(): UseRoomHook<R> {
  return function useRoom(): RoomMeta<R> {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;
    const initialPhase = (app.room.lifecycle[0] ?? "lobby") as LifecyclePhase;

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(s => s, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const phase = (snapshot?.lifecycle.phase ?? initialPhase) as LifecycleOf<R>;
    const participantCount = snapshot?.participants.size ?? 0;
    const status: ConnectionStatus = snapshot?.connection.status ?? "idle";
    const code = connection?.getRoomId() ?? "";
    const url = app.workerUrl;
    return Object.freeze({
      code,
      url,
      phase,
      participantCount,
      status,
    });
  };
}
