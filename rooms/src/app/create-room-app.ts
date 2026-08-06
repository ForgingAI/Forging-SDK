// `createRoomApp` — the load-bearing factory that turns a `RoomDefinition`
// into a typed hook namespace.
//
// Design (Convex/tRPC/Liveblocks pattern, Research-1b Finding 9):
//   const TriviaRoom = defineRoom({ ...schemas... });
//   const app = createRoomApp({ app_id, room: TriviaRoom, persistence });
//   const { useRoomState, useLeaderboard, ... } = app.hooks;
//
// Because `R` is a generic parameter captured by the factory, every hook on
// `app.hooks` knows the exact schema shape. A consumer who misspells a state
// key or asks for a non-existent leaderboard gets a TS error at the call site.
//
// Phase 1 scope: the factory builds the hook namespace and stores config.
// Hook bodies are placeholders (see ../hooks/index.ts). Wiring against a real
// `RoomConnection` happens in tasks 1.2.3 onward.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.2 (this factory).

import type { RoomDefinition } from "../schema/define-room";
import { buildHooks, type BoundHooks } from "../hooks/index";
import { RoomConnection, type GetAuthTokenFn, type RoomTransportFactory } from "../runtime/connection";

/**
 * Persistence mode for the room — controls how data is tiered across DO
 * SQLite, DynamoDB, and S3. Matches the Worker's `persistence_mode` column.
 */
export type RoomPersistence = "ephemeral" | "checkpointed" | "archived";

/**
 * Configuration for `createRoomApp`.
 *
 * - `app_id`: stable identifier of the consuming app. Scopes leaderboards,
 *   participant identities, and persisted artifacts.
 * - `room`: the `RoomDefinition` produced by `defineRoom`.
 * - `persistence`: storage tiering policy. See PLAN.md "Resolved Question A".
 * - `workerUrl`: optional override of the Worker base URL. Default is
 *   `wss://rooms.forging.dev`. Used by tests and self-hosted deployments.
 */
export interface CreateRoomAppOptions<R extends RoomDefinition> {
  readonly app_id: string;
  readonly room: R;
  readonly persistence: RoomPersistence;
  readonly workerUrl?: string;
  /**
   * The room id to connect to. Required when `getAuthToken` is provided;
   * otherwise the app is constructed in a "schema only" mode and `.connect()`
   * will throw.
   */
  readonly roomId?: string;
  /**
   * Async function returning a JWT (host) or signed cookie value (participant)
   * the worker accepts. The SDK does NOT mint tokens — that's the host app's
   * job. The function is awaited on every (re)connect so callers can refresh.
   */
  readonly getAuthToken?: GetAuthTokenFn;
  /** Test seam — inject a fake transport. Production uses PartySocket. */
  readonly transportFactory?: RoomTransportFactory;
  /**
   * Stable participant id for the connected client. Required for host-gated
   * hooks (`useHostControls`) to discriminate role via presence roster.
   */
  readonly participantId?: string;
}

/** The handle returned by `createRoomApp`. Hooks are the primary surface. */
export interface RoomApp<R extends RoomDefinition> {
  readonly app_id: string;
  readonly room: R;
  readonly persistence: RoomPersistence;
  readonly workerUrl: string;
  readonly hooks: BoundHooks<R>;
  /**
   * The runtime connection. Exposed publicly so the React context provider
   * (and advanced consumers) can read store snapshots and send mutations,
   * but treat it as internal-ish: prefer the hooks for normal use.
   *
   * `null` when the app was constructed without `roomId` + `getAuthToken`
   * (schema-only mode for SSR / type-only consumers).
   */
  readonly connection: RoomConnection | null;
  /** Open the underlying socket. Idempotent. Throws if app is schema-only. */
  connect(): Promise<void>;
  /** Permanently close the socket. After this, `connect()` throws. */
  disconnect(): void;
}

const DEFAULT_WORKER_URL = "wss://rooms.forging.dev";

const VALID_PERSISTENCE: ReadonlySet<RoomPersistence> = new Set([
  "ephemeral",
  "checkpointed",
  "archived",
]);

/**
 * Build a `RoomApp` bound to a specific `RoomDefinition`.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { defineRoom, createRoomApp, counter } from "@forging/rooms";
 *
 * const TriviaRoom = defineRoom({
 *   state: { phase: z.enum(["lobby", "active"]) },
 *   participantState: { score: counter({ init: 0 }) },
 *   leaderboards: {},
 *   lifecycle: ["lobby", "active"] as const,
 * });
 *
 * export const app = createRoomApp({
 *   app_id: "trivia",
 *   room: TriviaRoom,
 *   persistence: "checkpointed",
 * });
 *
 * // In a component:
 * const [phase, setPhase] = app.hooks.useRoomState("phase");
 * await setPhase((draft) => "active");
 * ```
 */
export function createRoomApp<R extends RoomDefinition>(
  opts: CreateRoomAppOptions<R>,
): RoomApp<R> {
  // Validate at construction time — better here than at first hook call.
  if (!opts.app_id || typeof opts.app_id !== "string") {
    throw new Error(
      "[@forging/rooms] createRoomApp: `app_id` must be a non-empty string.",
    );
  }
  if (
    !opts.room ||
    (opts.room as { __brand?: string }).__brand !== "ForgingRoomDefinition"
  ) {
    throw new Error(
      "[@forging/rooms] createRoomApp: `room` must be the return value of defineRoom().",
    );
  }
  if (!VALID_PERSISTENCE.has(opts.persistence)) {
    throw new Error(
      `[@forging/rooms] createRoomApp: invalid persistence "${String(
        opts.persistence,
      )}". Expected one of: ephemeral | checkpointed | archived.`,
    );
  }
  const workerUrl = opts.workerUrl ?? DEFAULT_WORKER_URL;

  const hooks = buildHooks<R>(opts.room);

  // Build the RoomConnection lazily on first `connect()` so consumers can
  // construct a schema-only `RoomApp` for SSR / type tests / docs without
  // pulling in the PartySocket bundle. The connection is cached after first
  // call; `disconnect()` marks it disposed.
  let connection: RoomConnection | null = null;
  const canConnect = !!opts.roomId && !!opts.getAuthToken;
  const ensureConnection = (): RoomConnection => {
    if (!canConnect) {
      throw new Error(
        "[@forging/rooms] createRoomApp: connect() requires both `roomId` and `getAuthToken` options.",
      );
    }
    if (!connection) {
      connection = new RoomConnection({
        appId: opts.app_id,
        roomId: opts.roomId as string,
        workerUrl,
        getAuthToken: opts.getAuthToken as GetAuthTokenFn,
        ...(opts.transportFactory ? { transportFactory: opts.transportFactory } : {}),
        ...(opts.participantId !== undefined ? { participantId: opts.participantId } : {}),
      });
    }
    return connection;
  };

  const app: RoomApp<R> = {
    app_id: opts.app_id,
    room: opts.room,
    persistence: opts.persistence,
    workerUrl,
    hooks,
    get connection(): RoomConnection | null {
      return connection;
    },
    async connect(): Promise<void> {
      await ensureConnection().connect();
    },
    disconnect(): void {
      connection?.disconnect();
    },
  };
  return Object.freeze(app);
}
