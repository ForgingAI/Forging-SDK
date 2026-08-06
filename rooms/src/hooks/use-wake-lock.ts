// useWakeLock — React hook that holds a screen wake-lock while `active` is true.
//
// Intended use:
//   const isHost = useRoom().role === "host";
//   const phase = useRoomLifecycle().phase;
//   useWakeLock(isHost && phase === "active");
//
// The hook owns its own WakeLockManager — it does not pull from the
// RoomConnection. This keeps the API decoupled: app code that wants to keep
// the screen on for any reason (countdown timer, video playback) can call
// `useWakeLock(true)` directly.
//
// Visibility integration:
//   The Wake Lock spec auto-releases the sentinel on page-hide. Re-acquiring
//   on return is the caller's job. We attach our own tiny visibility listener
//   here (mirroring the runtime's VisibilityCoordinator) so the hook works
//   standalone even outside a connected RoomApp.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.10 (this hook).

import { useEffect, useRef } from "react";

import { WakeLockManager } from "../runtime/wake-lock";

/**
 * Acquire/release a `screen` wake lock based on `active`.
 *
 * - When `active` flips to `true`, the hook acquires the lock.
 * - When `active` flips to `false`, the hook releases.
 * - On unmount, the lock is released.
 * - On `visibilitychange → visible`, if `active` is still true, re-acquires
 *   (the browser auto-releases on hide per spec).
 *
 * Safe to use anywhere a `useEffect` is safe — including SSR (the hook
 * gracefully no-ops when `navigator.wakeLock` is unavailable).
 */
export function useWakeLock(active: boolean): void {
  const managerRef = useRef<WakeLockManager | null>(null);

  if (managerRef.current === null) {
    managerRef.current = new WakeLockManager();
  }

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    let disposed = false;

    if (active) {
      void manager.acquire();
    } else {
      void manager.release();
    }

    const onVisibilityChange = (): void => {
      if (disposed) return;
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        manager.onVisibilityHidden();
      } else if (active) {
        void manager.onVisibilityVisible();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      disposed = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      void manager.release();
    };
  }, [active]);
}
