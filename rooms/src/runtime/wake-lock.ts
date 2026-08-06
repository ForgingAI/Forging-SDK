// WakeLockManager — owns a `screen` wake-lock sentinel for hosts during the
// active phase of a multiplayer room.
//
// Why this exists:
//   The host of a TV-attached trivia/quiz room shouldn't see the screen lock
//   midway through a 60-minute session. The Screen Wake Lock API
//   (`navigator.wakeLock.request("screen")`) keeps the display awake while a
//   sentinel is held. Per the spec, the sentinel is automatically released
//   when the page becomes hidden — so callers also have to re-acquire on
//   `visibilitychange → visible`. We expose hooks for that.
//
// Scope:
//   Only hosts call `acquire()` (the React hook gates by role). Only the
//   `"active"` lifecycle phase justifies holding the lock — lobby/ended phases
//   release. The phase gate lives in `hooks/use-wake-lock.ts`; this class is
//   intentionally policy-free.
//
// Compatibility:
//   - Chrome (desktop+Android): supported since 84.
//   - Edge: 84+.
//   - Safari/macOS: 16.4+.
//   - Safari/iOS: 16.4+ — earlier iOS Safari does NOT expose `navigator.wakeLock`.
//   - Firefox: 126+ (May 2024).
//   When unavailable, `acquire()` resolves to `null` and logs a single warning;
//   the rest of the SDK continues to function (screen will lock per OS policy).
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.10 (this module).
//   - RESEARCH-1b-sdk-ergonomics.md Finding 8 (mobile visibility + wake lock).

// ─── Browser type shims ───────────────────────────────────────────────────
//
// We declare a minimal local shape rather than relying on lib.dom.d.ts's
// `WakeLockSentinel` because the SDK is consumed in non-DOM environments
// (workers, SSR) where the global is missing. The local shape captures the
// only fields we touch.

export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener?(type: "release", listener: () => void): void;
}

interface WakeLockApiLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

interface NavigatorWithWakeLock {
  wakeLock?: WakeLockApiLike;
}

export interface WakeLockManagerOptions {
  /** Override the global navigator (test seam). */
  readonly navigatorOverride?: NavigatorWithWakeLock | null;
  /** Optional logger; defaults to console.warn. */
  readonly logger?: {
    warn: (msg: string, ctx?: unknown) => void;
    debug?: (msg: string, ctx?: unknown) => void;
  };
}

const defaultLogger = {
  warn: (msg: string, ctx?: unknown): void => {
    // eslint-disable-next-line no-console
    console.warn(`[@forging/rooms/wake-lock] ${msg}`, ctx ?? "");
  },
  debug: (_msg: string, _ctx?: unknown): void => undefined,
};

/**
 * Lifecycle: idle → held (after `acquire()` resolves) → released (after
 * `release()` or sentinel-release event) → may be re-acquired.
 *
 * The manager is stateful: it remembers whether the caller *wanted* the lock
 * held so it can re-acquire after the spec-mandated auto-release on visibility
 * hide. Call `onVisibilityVisible()` from a `visibilitychange → visible` event
 * to trigger that re-acquire, and `onVisibilityHidden()` to flip the
 * "released by browser" bookkeeping without changing user intent.
 */
export class WakeLockManager {
  private readonly nav: NavigatorWithWakeLock | null;
  private readonly logger: NonNullable<WakeLockManagerOptions["logger"]>;

  private sentinel: WakeLockSentinelLike | null = null;
  /** Caller intent — does the app want the lock held right now? */
  private wantsLock = false;
  /** One-shot guard so we only log the "unavailable" warning once. */
  private warnedUnavailable = false;
  private releaseListener: (() => void) | null = null;

  constructor(opts: WakeLockManagerOptions = {}) {
    this.nav = WakeLockManager.resolveNavigator(opts.navigatorOverride);
    this.logger = opts.logger ?? defaultLogger;
  }

  private static resolveNavigator(
    override: NavigatorWithWakeLock | null | undefined,
  ): NavigatorWithWakeLock | null {
    if (override !== undefined) return override;
    if (typeof navigator !== "undefined") {
      return navigator as unknown as NavigatorWithWakeLock;
    }
    return null;
  }

  /** True if the SDK has the screen wake-lock sentinel right now. */
  isHeld(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** True if the caller has expressed intent to keep the screen awake. */
  isDesired(): boolean {
    return this.wantsLock;
  }

  /**
   * Acquire the wake lock. Idempotent — if already held, returns the current
   * sentinel. Resolves to `null` (and logs once) if the API is unavailable or
   * the browser denies the request (e.g. low battery, embedded iframe).
   */
  async acquire(): Promise<WakeLockSentinelLike | null> {
    this.wantsLock = true;
    if (this.sentinel && !this.sentinel.released) {
      return this.sentinel;
    }
    if (!this.nav || !this.nav.wakeLock) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        this.logger.warn(
          "navigator.wakeLock unavailable; screen will lock per OS policy (Safari < 16.4, Firefox < 126).",
        );
      }
      return null;
    }
    try {
      const s = await this.nav.wakeLock.request("screen");
      this.sentinel = s;
      const onRelease = (): void => {
        // Sentinel went away (visibility hide or browser-initiated). Drop our
        // reference but keep `wantsLock` so visibility-return re-acquires.
        this.sentinel = null;
        this.releaseListener = null;
      };
      this.releaseListener = onRelease;
      s.addEventListener("release", onRelease);
      this.logger.debug?.("wake lock acquired");
      return s;
    } catch (err: unknown) {
      this.logger.warn("wake lock request denied", { err });
      return null;
    }
  }

  /**
   * Release the wake lock. Clears `wantsLock` so visibility-return won't
   * re-acquire. Safe to call when nothing is held.
   */
  async release(): Promise<void> {
    this.wantsLock = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (!s || s.released) return;
    if (this.releaseListener && s.removeEventListener) {
      try {
        s.removeEventListener("release", this.releaseListener);
      } catch {
        /* ignore */
      }
    }
    this.releaseListener = null;
    try {
      await s.release();
      this.logger.debug?.("wake lock released");
    } catch (err: unknown) {
      this.logger.warn("wake lock release failed", { err });
    }
  }

  /**
   * Called by VisibilityCoordinator when the page goes hidden. The browser
   * auto-releases the sentinel per spec; we just drop our reference and
   * preserve the `wantsLock` flag so the next `onVisibilityVisible()` triggers
   * a re-acquire.
   */
  onVisibilityHidden(): void {
    // The sentinel will fire its own 'release' event — but on some engines
    // that's async/slow, so clear synchronously to keep `isHeld()` accurate.
    this.sentinel = null;
  }

  /**
   * Called by VisibilityCoordinator when the page becomes visible again. If
   * the caller still wants the lock, re-acquire. Returns the new sentinel or
   * null if re-acquire failed / was not requested.
   */
  async onVisibilityVisible(): Promise<WakeLockSentinelLike | null> {
    if (!this.wantsLock) return null;
    return this.acquire();
  }
}
