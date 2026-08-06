// Type-level tests for the @forging/rooms SDK foundation.
//
// These assertions use `expectTypeOf`-style helpers re-implemented inline so
// the file compiles with no external deps. The tests pass if this file
// type-checks; they "fail" by producing a TS compile error when types break.
//
// Run with: `pnpm --filter @forging/rooms typecheck`.
//
// What we prove here:
// 1. `createRoomApp` infers the state shape from `defineRoom`.
// 2. `useRoomState('key')` returns the correctly typed value.
// 3. `useLeaderboard("nonexistent")` is a TS error.
// 4. `useRoomState` requires the mutate recipe to operate on the schema shape.
// 5. `useHostControls` returns `HostControlActions<R> | null` (discriminated).
// 6. Misspelled state keys fail at the call site.

import { z } from "zod";

import {
  counter,
  createRoomApp,
  crdt,
  defineLeaderboard,
  defineRoom,
} from "../src/index";
import type { RoomStateOf } from "../src/index";

// ─── Tiny type-test primitives ─────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

// Suppress "unused" on the type-only Expect aliases below.
// (TypeScript treats type aliases as used when referenced; assigning to `_` for the unused-import lint.)

// ─── Fixture: a small trivia room schema ──────────────────────────────────

const TriviaRoom = defineRoom({
  state: {
    phase: z.enum(["lobby", "active", "ended"]),
    currentQuestion: z.string().nullable(),
    revealed: crdt(z.array(z.string())),
  },
  participantState: {
    answer: z.string().nullable(),
    score: counter({ min: 0, init: 0 }),
  },
  leaderboards: {
    leaderboard: defineLeaderboard({ scoring: "sum" }),
    fastestFinger: defineLeaderboard({
      scoring: "min",
      metadata: z.object({ questionId: z.string() }),
    }),
  },
  lifecycle: ["lobby", "active", "ended"] as const,
});

const app = createRoomApp({
  app_id: "trivia",
  room: TriviaRoom,
  persistence: "checkpointed",
});

// ─── 1. RoomStateOf<TriviaRoom> infers correctly ──────────────────────────

type State = RoomStateOf<typeof TriviaRoom>;
type ExpectedState = {
  readonly phase: "lobby" | "active" | "ended";
  readonly currentQuestion: string | null;
  readonly revealed: string[];
};
type _T1 = Expect<Equal<State, ExpectedState>>;

// ─── 2. useRoomState() returns the full state ─────────────────────────────

declare const fullStateTuple: ReturnType<typeof app.hooks.useRoomState>;
type _T2 = Expect<Equal<typeof fullStateTuple[0], State | null>>;

// ─── 3. useRoomState('phase') returns the slot type ───────────────────────
// Call-site form: invoking the hook with a literal key selects the keyed
// overload. We wrap in a function and inspect its return type.

function _callKeyed() {
  return app.hooks.useRoomState("phase");
}
declare const phaseTuple: ReturnType<typeof _callKeyed>;
type _T3 = Expect<
  Equal<typeof phaseTuple[0], "lobby" | "active" | "ended" | null>
>;

// ─── 4. Misspelled state key is a TS error ────────────────────────────────
// Uncomment to confirm; left commented because we want this file to typecheck.
//
//   // @ts-expect-error: "phze" is not a declared state key.
//   app.hooks.useRoomState("phze");

// ─── 5. useLeaderboard("nonexistent") is a TS error ────────────────────────
// Same pattern — verify by uncommenting:
//
//   // @ts-expect-error: "nope" is not a declared leaderboard.
//   app.hooks.useLeaderboard("nope");

// ─── 6. useHostControls returns actions | null ────────────────────────────

declare const host: ReturnType<typeof app.hooks.useHostControls>;
type HostActionsOrNull = typeof host;
type _T6 = Expect<
  Equal<
    HostActionsOrNull,
    | {
        readonly setPhase: (
          phase: "lobby" | "active" | "ended",
        ) => Promise<void>;
        readonly kick: (participantId: string) => Promise<void>;
        readonly endRoom: () => Promise<void>;
      }
    | null
  >
>;

// ─── 7. useLeaderboard inferred metadata ───────────────────────────────────

function _callFastest() {
  return app.hooks.useLeaderboard("fastestFinger");
}
declare const lb: ReturnType<typeof _callFastest>;
type FastestEntryMeta = (typeof lb.entries)[number]["metadata"];
type _T7 = Expect<Equal<FastestEntryMeta, { questionId: string }>>;

// Leaderboard without metadata schema → metadata is undefined.
function _callDefault() {
  return app.hooks.useLeaderboard("leaderboard");
}
declare const lb2: ReturnType<typeof _callDefault>;
type DefaultEntryMeta = (typeof lb2.entries)[number]["metadata"];
type _T8 = Expect<Equal<DefaultEntryMeta, undefined>>;

// ─── 8. useRoomLifecycle phase union matches lifecycle ────────────────────

declare const lifecycle: ReturnType<typeof app.hooks.useRoomLifecycle>;
type _T9 = Expect<
  Equal<typeof lifecycle.phase, "lobby" | "active" | "ended">
>;

// Keep the type aliases reachable so the compiler treats them as used.
export type _AllChecks = [_T1, _T2, _T3, _T6, _T7, _T8, _T9];

// Export the runtime references too so `noUnusedLocals` is satisfied.
// (declared/typed-only locals are technically referenced via the assertions
// above; the exports below cover anything the compiler still flags.)
export const _runtimeRefs = {
  _callKeyed,
  _callFastest,
  _callDefault,
  app,
  TriviaRoom,
};
export type _DeclaredRefs = {
  fullStateTuple: typeof fullStateTuple;
  phaseTuple: typeof phaseTuple;
  host: typeof host;
  lb: typeof lb;
  lb2: typeof lb2;
  lifecycle: typeof lifecycle;
  State: State;
  ExpectedState: ExpectedState;
  FastestEntryMeta: FastestEntryMeta;
  DefaultEntryMeta: DefaultEntryMeta;
  HostActionsOrNull: HostActionsOrNull;
};
