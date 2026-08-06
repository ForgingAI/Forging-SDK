// VisibilityCoordinator — observes browser page-lifecycle events and emits
// SDK-friendly callbacks the connection layer can wire.
//
// Why this exists:
//   Mobile browsers (iOS Safari, Android Chrome) silently drop WebSockets when
//   a tab is backgrounded for 30s–2min. The Phoenix 1.8.2 pattern fixes this by
//   listening to `visibilitychange` and aggressively reconnecting on return.
//   We extend that with two mobile-specific signals:
//
//     - `pagehide`  — fired when the browser is about to evict the page or the
//                     user navigates away. Treated as a probable shutdown; an
//                     opportunity to flush a "going offline" beacon.
//     - `pageshow`  — fires on restore, including bfcache restore. When
//                     `event.persisted === true` the page came back from the
//                     back-forward cache and any cached WS / timers are stale.
//                     We treat this like a fresh connect.
//
// Threshold rationale:
//   Apps switch focus all the time (Android pull-down notification, iOS Slide
//   Over, copy-paste tray). We don't want to ping-or-reconnect every time the
//   tab loses focus for 800ms. The default 5000ms hidden threshold separates
//   real backgrounding from quick context switches. Below 5s: assume the WS
//   survived; skip the recovery probe. Above 5s: probe-or-reconnect.
//   Calibrated against the iOS Safari 30s WS-drop window with a safety margin.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.10 (this module).
//   - RESEARCH-1b-sdk-ergonomics.md Finding 8 (Phoenix PR #6534 pattern).

// ─── Browser type shims ───────────────────────────────────────────────────

interface DocumentLike {
  visibilityState?: "visible" | "hidden" | "prerender" | "unloaded" | string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface WindowLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

/** Subset of `PageTransitionEvent` we care about. */
export interface PageShowEvent {
  readonly persisted: boolean;
}

export interface VisibilityCoordinatorOptions {
  /** Override the document (test seam). */
  readonly documentOverride?: DocumentLike | null;
  /** Override the window (test seam). */
  readonly windowOverride?: WindowLike | null;
  /** Override `Date.now` (test seam). */
  readonly nowFn?: () => number;
  /**
   * Minimum hidden duration (ms) before `onVisibleRecovery` fires on return.
   * Anything under this is treated as a quick app switch — no recovery probe.
   * Default: 5000.
   */
  readonly hiddenRecoveryThresholdMs?: number;
}

const DEFAULT_HIDDEN_THRESHOLD_MS = 5_000;

export interface VisibilityCallbacks {
  /** Fired on `visibilitychange → hidden`. Stash the hidden-since timestamp. */
  readonly onHidden?: () => void;
  /**
   * Fired on `visibilitychange → visible` ONLY when the previous hidden span
   * exceeded the threshold. Use this to send a ping or force reconnect.
   */
  readonly onVisibleRecovery?: (hiddenDurationMs: number) => void;
  /** Fired on `visibilitychange → visible` even for short hides. */
  readonly onVisible?: (hiddenDurationMs: number) => void;
  /** Fired on `pagehide`. Best-effort offline beacon goes here. */
  readonly onPageHide?: () => void;
  /**
   * Fired on `pageshow`. If `event.persisted === true` the page came back from
   * the bfcache and should be treated like a fresh connect.
   */
  readonly onPageShow?: (event: PageShowEvent) => void;
}

/**
 * VisibilityCoordinator wires `visibilitychange`, `pagehide`, and `pageshow`
 * into a small callback surface. Construct once per connection, call `start`
 * to subscribe and `stop` to tear down. Callbacks are settable post-construct
 * via `setCallbacks` so the same coordinator can be re-pointed if the
 * connection rebuilds them.
 */
export class VisibilityCoordinator {
  private readonly doc: DocumentLike | null;
  private readonly win: WindowLike | null;
  private readonly now: () => number;
  private readonly threshold: number;

  private callbacks: VisibilityCallbacks = {};
  private started = false;
  private hiddenSince: number | null = null;

  private readonly visibilityHandler = (): void => this.onVisibilityChange();
  private readonly pageHideHandler = (): void => this.onPageHide();
  private readonly pageShowHandler = (ev: unknown): void => this.onPageShow(ev);

  constructor(opts: VisibilityCoordinatorOptions = {}) {
    this.doc = VisibilityCoordinator.resolveDocument(opts.documentOverride);
    this.win = VisibilityCoordinator.resolveWindow(opts.windowOverride);
    this.now = opts.nowFn ?? Date.now;
    this.threshold = opts.hiddenRecoveryThresholdMs ?? DEFAULT_HIDDEN_THRESHOLD_MS;
  }

  private static resolveDocument(
    override: DocumentLike | null | undefined,
  ): DocumentLike | null {
    if (override !== undefined) return override;
    if (typeof document !== "undefined") return document as unknown as DocumentLike;
    return null;
  }

  private static resolveWindow(
    override: WindowLike | null | undefined,
  ): WindowLike | null {
    if (override !== undefined) return override;
    if (typeof window !== "undefined") return window as unknown as WindowLike;
    return null;
  }

  setCallbacks(cbs: VisibilityCallbacks): void {
    this.callbacks = { ...cbs };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc?.addEventListener("visibilitychange", this.visibilityHandler);
    this.win?.addEventListener("pagehide", this.pageHideHandler);
    this.win?.addEventListener("pageshow", this.pageShowHandler);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.hiddenSince = null;
    this.doc?.removeEventListener("visibilitychange", this.visibilityHandler);
    this.win?.removeEventListener("pagehide", this.pageHideHandler);
    this.win?.removeEventListener("pageshow", this.pageShowHandler);
  }

  /** Internal: read current visibilityState; default to "visible" when absent. */
  isHidden(): boolean {
    return this.doc?.visibilityState === "hidden";
  }

  private onVisibilityChange(): void {
    if (this.isHidden()) {
      this.hiddenSince = this.now();
      this.callbacks.onHidden?.();
      return;
    }
    // Transitioned to visible.
    const since = this.hiddenSince;
    this.hiddenSince = null;
    const duration = since === null ? 0 : Math.max(0, this.now() - since);
    this.callbacks.onVisible?.(duration);
    if (duration >= this.threshold) {
      this.callbacks.onVisibleRecovery?.(duration);
    }
  }

  private onPageHide(): void {
    this.callbacks.onPageHide?.();
  }

  private onPageShow(ev: unknown): void {
    // PageTransitionEvent shape; tolerate plain objects in tests.
    const persisted =
      typeof ev === "object" && ev !== null && "persisted" in ev
        ? Boolean((ev as { persisted?: unknown }).persisted)
        : false;
    this.callbacks.onPageShow?.({ persisted });
  }
}
