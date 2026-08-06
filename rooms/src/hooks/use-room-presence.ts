// `useRoomPresence` — observable list of participants, ordered by joinedAt
// ASC (oldest first). Subscribes to the store's presence map.

import { useCallback, useSyncExternalStore } from "react";

import type { ParticipantPresence, RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";

import type { PresenceParticipant, UseRoomPresenceHook } from "./types";

const EMPTY_PRESENCE: readonly PresenceParticipant[] = Object.freeze([]);

export const useRoomPresence: UseRoomPresenceHook = function useRoomPresenceImpl(): readonly PresenceParticipant[] {
  const app = useRoomAppContext();
  const store = app.connection?.getStore() ?? null;

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
  if (snapshot === null) return EMPTY_PRESENCE;
  return buildPresenceList(snapshot);
};

function buildPresenceList(
  snapshot: RoomStoreSnapshot,
): readonly PresenceParticipant[] {
  const entries: { id: string; p: ParticipantPresence }[] = [];
  for (const [id, p] of snapshot.participants) entries.push({ id, p });
  entries.sort((a, b) => a.p.joinedAt - b.p.joinedAt);
  return Object.freeze(
    entries.map(({ id, p }) =>
      Object.freeze({
        participantId: id,
        displayName: p.displayName,
        role: p.role,
        online: p.online,
        joinedAt: p.joinedAt,
      }),
    ),
  );
}
