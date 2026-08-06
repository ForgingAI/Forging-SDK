// `<RoomLifecycleGate phase=...>` — phase-gated conditional renderer.
//
// Use this to swap UI by lifecycle phase without manually writing
// `if (phase === "lobby")` ladders in every screen:
//
//   <RoomLifecycleGate phase="lobby"><Lobby /></RoomLifecycleGate>
//   <RoomLifecycleGate phase={["active", "paused"]}><Game /></RoomLifecycleGate>

import type { JSX, ReactNode } from "react";

import { useRoomAppContext } from "../runtime/react-context";
import type { LifecyclePhase } from "../schema/define-room";

export interface RoomLifecycleGateProps {
  /** A single phase or an array of phases to match. */
  readonly phase: LifecyclePhase | readonly LifecyclePhase[];
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

export function RoomLifecycleGate(
  props: RoomLifecycleGateProps,
): JSX.Element | null {
  const app = useRoomAppContext();
  const { phase: currentPhase } = app.hooks.useRoomLifecycle();
  const allowed = Array.isArray(props.phase)
    ? (props.phase as readonly LifecyclePhase[])
    : [props.phase as LifecyclePhase];
  const matches = allowed.includes(currentPhase);
  if (matches) {
    return <>{props.children}</>;
  }
  return props.fallback === undefined ? null : <>{props.fallback}</>;
}
