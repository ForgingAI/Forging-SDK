// `useReactions` — send + observe ephemeral participant reactions.
//
// Wire design choice: reactions ride a dedicated `target: "reactions.send"`
// path on the wire schema (extended in `wire-format.ts`). Each send is one
// patch with `{op:"replace", path:"/event", value: {emoji, at}}`. The Worker
// fans this out as a `state_delta` with the same target/key so connected
// clients can append into a rolling window. This keeps reactions out of the
// authoritative state cells (no version conflicts, no replay) while still
// going through the validated mutation pipeline (rate-limiting hooks land
// in Sub-track 1.4).
//
// The companion `recent` array is the last {@link REACTIONS_WINDOW} events,
// FIFO order with newest last.

import { useCallback, useSyncExternalStore } from "react";

import type { ReactionEvent, RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";

import type { UseReactionsHook, UseReactionsResult } from "./types";

const EMPTY_REACTIONS: readonly ReactionEvent[] = Object.freeze([]);

export const useReactions: UseReactionsHook = function useReactionsImpl(): UseReactionsResult {
  const app = useRoomAppContext();
  const connection = app.connection;
  const store = connection?.getStore() ?? null;

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!store) return () => undefined;
      return store.subscribe(s => s.reactions, () => cb());
    },
    [store],
  );

  const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
    return store?.getSnapshot() ?? null;
  }, [store]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const recent = snapshot?.reactions ?? EMPTY_REACTIONS;

  const send = useCallback(
    async (emoji: string): Promise<void> => {
      if (!connection) {
        throw new Error(
          "[@forging/rooms] useReactions.send: no live RoomConnection.",
        );
      }
      await connection.sendReaction(emoji);
    },
    [connection],
  );

  return Object.freeze({ send, recent });
};
