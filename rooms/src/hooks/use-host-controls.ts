// `useHostControls` — host-gated RPC surface.
//
// Returns the typed action object when the connection's participant id
// matches a "host" role in the presence roster; returns `null` for
// participants. The three-layer defense (Research-1b Finding 6) is:
//   - Compile-time: the return type is `HostControlActions<R> | null`, so
//     consumers must narrow before calling actions.
//   - Runtime: this hook returns null for non-hosts, hiding the actions.
//   - Server: every host.action mutation is independently re-validated by
//     the Worker (sub-track 1.1.7d).
//
// Actions ride the `target: "host.action"` wire path with `key` set to the
// action name (`setPhase`, `kick`, `endRoom`).

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";
import type {
  LifecycleOf,
  RoomDefinition,
} from "../schema/define-room";

import type {
  HostControlActions,
  UseHostControlsHook,
} from "./types";

export function createUseHostControls<R extends RoomDefinition>(): UseHostControlsHook<R> {
  return function useHostControls(): HostControlActions<R> | null {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(s => s.participants, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const role = useMemo(() => {
      if (!connection) return null;
      const pid = connection.getParticipantId();
      if (!pid || !snapshot) return null;
      return snapshot.participants.get(pid)?.role ?? null;
    }, [connection, snapshot]);

    return useMemo<HostControlActions<R> | null>(() => {
      if (role !== "host" || !connection) return null;
      const actions: HostControlActions<R> = Object.freeze({
        setPhase: async (phase: LifecycleOf<R>): Promise<void> => {
          await connection.sendHostAction("setPhase", { phase });
        },
        kick: async (participantId: string): Promise<void> => {
          if (typeof participantId !== "string" || participantId.length === 0) {
            throw new Error(
              "[@forging/rooms] useHostControls.kick: `participantId` is required.",
            );
          }
          await connection.sendHostAction("kick", { participantId });
        },
        endRoom: async (): Promise<void> => {
          await connection.sendHostAction("endRoom", {});
        },
      });
      return actions;
    }, [role, connection]);
  };
}
