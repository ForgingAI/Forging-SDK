// Shared `HookMeta` constructor — derived from a `RoomStoreSnapshot`. Centralized
// so all mutation/read hooks expose the same status / version / stale shape.

import type { RoomStoreSnapshot } from "../runtime/store";

import type { HookMeta } from "./types";

const IDLE_META: HookMeta = Object.freeze({
  status: "idle",
  lastSyncedAt: null,
  version: 0,
  stale: false,
});

/** Build a {@link HookMeta} from the current store snapshot (or null). */
export function buildHookMeta(snapshot: RoomStoreSnapshot | null): HookMeta {
  if (snapshot === null) return IDLE_META;
  const conn = snapshot.connection;
  // `stale` is true while the connection is not actively serving fresh
  // broadcasts — i.e. anything other than `live`. Replaying counts as stale
  // because the optimistic view diverges from the authoritative seq until
  // replay completes.
  const stale = conn.status !== "live";
  // `lastSyncedAt` is the highest server timestamp we have observed via a
  // state-bearing snapshot (room or participant state). We approximate using
  // the connection's `lastSeq` * 0 + null when no events have landed, falling
  // back to `null` when nothing has synced yet.
  let lastSyncedAt: number | null = null;
  for (const cell of snapshot.roomState.values()) {
    if (cell.server_ts > (lastSyncedAt ?? 0)) lastSyncedAt = cell.server_ts;
  }
  return Object.freeze({
    status: conn.status,
    lastSyncedAt,
    version: snapshot.lastProcessedSeq,
    stale,
  });
}
