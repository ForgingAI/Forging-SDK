// React context plumbing for the Forging Rooms SDK runtime.
//
// `<RoomAppProvider>` makes the `RoomApp` (and therefore its `RoomConnection`
// + `RoomStore`) available to descendant components. Internal hooks consume
// this via `useRoomAppContext()`.
//
// For Phase 1 (task 1.2.3) we set up the context only; the typed hook
// implementations land in task 1.2.4. The hook bodies in `hooks/index.ts`
// continue to throw "not yet wired" errors until then.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.3 (context plumbing).
//   - Sub-track 1.2 task 1.2.4 (hook bodies consume this context).

import { createContext, useContext, type JSX, type ReactNode } from "react";

import type { RoomApp } from "../app/create-room-app";
import type { RoomDefinition } from "../schema/define-room";

// We can't parametrize React context by a generic at module scope, so the
// context stores a `RoomApp<RoomDefinition>` (the widened base type) and
// the typed hooks at call-time narrow it back to the caller's `R`.
const RoomAppContext = createContext<RoomApp<RoomDefinition> | null>(null);

export interface RoomAppProviderProps<R extends RoomDefinition> {
  readonly app: RoomApp<R>;
  readonly children: ReactNode;
}

/**
 * Provide a `RoomApp` to descendant components.
 *
 * Multiple providers can be nested (e.g. an outer game room + an inner side
 * channel); each `useRoomAppContext` call reads the nearest provider.
 */
export function RoomAppProvider<R extends RoomDefinition>(
  props: RoomAppProviderProps<R>,
): JSX.Element {
  return (
    <RoomAppContext.Provider value={props.app as unknown as RoomApp<RoomDefinition>}>
      {props.children}
    </RoomAppContext.Provider>
  );
}

/**
 * Read the current `RoomApp` from context. Throws if used outside a provider —
 * this matches the convention of `useContext()` consumers in @tanstack/query,
 * Apollo, etc., where missing-provider is treated as a programming error.
 */
export function useRoomAppContext<R extends RoomDefinition = RoomDefinition>(): RoomApp<R> {
  const ctx = useContext(RoomAppContext);
  if (!ctx) {
    throw new Error(
      "[@forging/rooms] useRoomAppContext: no <RoomAppProvider> ancestor. Wrap your tree in <RoomAppProvider app={...}>.",
    );
  }
  return ctx as unknown as RoomApp<R>;
}

/** Test seam: a context-aware reader that returns `null` instead of throwing. */
export function useRoomAppContextOptional<R extends RoomDefinition = RoomDefinition>(): RoomApp<R> | null {
  return useContext(RoomAppContext) as unknown as RoomApp<R> | null;
}
