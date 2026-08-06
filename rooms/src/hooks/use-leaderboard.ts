// `useLeaderboard(name)` — bound to a leaderboard declared in the room schema.
//
// Returns `{entries, status, submit}` where:
//   - `entries` is the current top-N (server-broadcast ordering).
//   - `submit(score, metadata?)` enqueues a `leaderboard.award` mutation; the
//     worker turns this into a single atomic `UpdateItem ADD score` (Research-1b
//     Pitfall 5 — never decompose into read/modify/write).
//
// Compile-time safety: `name` must be a key of `R["leaderboards"]`, so the
// caller can't ask for a board the schema didn't declare.

import { useCallback, useSyncExternalStore } from "react";

import type { LeaderboardRow, RoomStoreSnapshot } from "../runtime/store";
import { useRoomAppContext } from "../runtime/react-context";
import type {
  LeaderboardNamesOf,
  RoomDefinition,
} from "../schema/define-room";
import type { LeaderboardMetadataOf } from "../schema/leaderboard";

import type {
  ConnectionStatus,
  LeaderboardEntry,
  UseLeaderboardHook,
  UseLeaderboardResult,
} from "./types";

const EMPTY_ENTRIES: readonly LeaderboardEntry[] = Object.freeze([]);

export function createUseLeaderboard<R extends RoomDefinition>(): UseLeaderboardHook<R> {
  return function useLeaderboard<N extends LeaderboardNamesOf<R>>(
    name: N,
  ): UseLeaderboardResult<
    LeaderboardMetadataOf<R["leaderboards"][N]> extends undefined
      ? undefined
      : LeaderboardMetadataOf<R["leaderboards"][N]>
  > {
    const app = useRoomAppContext<R>();
    const connection = app.connection;
    const store = connection?.getStore() ?? null;

    const subscribe = useCallback(
      (cb: () => void) => {
        if (!store) return () => undefined;
        return store.subscribe(s => s.leaderboards, () => cb());
      },
      [store],
    );

    const getSnapshot = useCallback((): RoomStoreSnapshot | null => {
      return store?.getSnapshot() ?? null;
    }, [store]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const rows = snapshot?.leaderboards.get(name) ?? null;
    const entries = rows === null ? EMPTY_ENTRIES : toEntries(rows);
    const status: ConnectionStatus = snapshot?.connection.status ?? "idle";

    const submit = useCallback(
      async (score: number, metadata?: unknown): Promise<void> => {
        if (!connection) {
          throw new Error(
            "[@forging/rooms] useLeaderboard.submit: no live RoomConnection.",
          );
        }
        await connection.sendLeaderboardAward(name, score, metadata);
      },
      [connection, name],
    );

    return Object.freeze({ entries, status, submit }) as UseLeaderboardResult<
      LeaderboardMetadataOf<R["leaderboards"][N]> extends undefined
        ? undefined
        : LeaderboardMetadataOf<R["leaderboards"][N]>
    >;
  };
}

function toEntries(rows: readonly LeaderboardRow[]): readonly LeaderboardEntry[] {
  return Object.freeze(
    rows.map(r =>
      Object.freeze({
        participantId: r.participantId,
        displayName: r.displayName,
        score: r.score,
        rank: r.rank,
        metadata: r.metadata as never,
      }),
    ),
  );
}
