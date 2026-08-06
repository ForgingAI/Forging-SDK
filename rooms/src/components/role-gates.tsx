// `<HostOnly>` and `<ParticipantOnly>` — role-gated conditional renderers.
//
// Discriminator: `useHostControls()` returns a non-null `HostControlActions`
// object when the current participant is the room's host; otherwise `null`.
// Per the typed-context design in Research-1b Finding 6, the components
// themselves are pure conditional wrappers. (The deeper "context that narrows
// the mutator type" pattern lives in the hook layer; here we just gate render.)
//
// Implementation note: we read the bound `useHostControls` off the `RoomApp`
// provided by `<RoomAppProvider>`. This matches every other SDK component —
// no prop drilling required.

import type { JSX, ReactNode } from "react";

import { useRoomAppContext } from "../runtime/react-context";

export interface HostOnlyProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

export interface ParticipantOnlyProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

/** Render `children` only when the current viewer is the room host. */
export function HostOnly(props: HostOnlyProps): JSX.Element | null {
  const app = useRoomAppContext();
  const controls = app.hooks.useHostControls();
  if (controls !== null) {
    return <>{props.children}</>;
  }
  return props.fallback === undefined ? null : <>{props.fallback}</>;
}

/** Render `children` only when the current viewer is NOT the room host. */
export function ParticipantOnly(props: ParticipantOnlyProps): JSX.Element | null {
  const app = useRoomAppContext();
  const controls = app.hooks.useHostControls();
  if (controls === null) {
    return <>{props.children}</>;
  }
  return props.fallback === undefined ? null : <>{props.fallback}</>;
}
