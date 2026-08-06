// Wake-lock manager tests (task 1.2.10).
//
// Covers:
//   - acquire when API present → sentinel held.
//   - release → sentinel released, wantsLock cleared.
//   - re-acquire after visibility return when still desired.
//   - graceful no-op when navigator.wakeLock undefined.
//   - graceful no-op when request() rejects.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   Sub-track 1.2 task 1.2.10.

import { describe, expect, it, vi } from "vitest";

import { WakeLockManager, type WakeLockSentinelLike } from "../src/runtime/wake-lock";

// ─── Test fakes ────────────────────────────────────────────────────────────

interface FakeSentinel extends WakeLockSentinelLike {
  readonly id: number;
  releaseCalled: boolean;
  fireReleaseEvent(): void;
}

function makeSentinel(id: number): FakeSentinel {
  const listeners: Array<() => void> = [];
  let released = false;
  return {
    id,
    releaseCalled: false,
    get released() {
      return released;
    },
    async release() {
      this.releaseCalled = true;
      released = true;
      for (const l of listeners) l();
    },
    addEventListener(type, listener) {
      if (type === "release") listeners.push(listener);
    },
    removeEventListener(type, listener) {
      if (type !== "release") return;
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    fireReleaseEvent() {
      released = true;
      for (const l of listeners) l();
    },
  } as FakeSentinel;
}

function makeFakeNavigator(): {
  navigatorOverride: { wakeLock: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
  sentinels: FakeSentinel[];
  requestCalls: Array<"screen">;
  rejectNext: (msg?: string) => void;
} {
  const sentinels: FakeSentinel[] = [];
  const requestCalls: Array<"screen"> = [];
  let rejectMsg: string | null = null;
  return {
    navigatorOverride: {
      wakeLock: {
        request: async (type: "screen") => {
          requestCalls.push(type);
          if (rejectMsg !== null) {
            const m = rejectMsg;
            rejectMsg = null;
            throw new Error(m);
          }
          const s = makeSentinel(sentinels.length);
          sentinels.push(s);
          return s;
        },
      },
    },
    sentinels,
    requestCalls,
    rejectNext: (msg = "denied") => {
      rejectMsg = msg;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("WakeLockManager", () => {
  it("acquires a sentinel when API available; isHeld() flips true", async () => {
    const fake = makeFakeNavigator();
    const m = new WakeLockManager({ navigatorOverride: fake.navigatorOverride });

    expect(m.isHeld()).toBe(false);
    const s = await m.acquire();

    expect(s).not.toBeNull();
    expect(m.isHeld()).toBe(true);
    expect(fake.requestCalls).toEqual(["screen"]);
    expect(fake.sentinels).toHaveLength(1);
  });

  it("release() releases the sentinel and clears intent", async () => {
    const fake = makeFakeNavigator();
    const m = new WakeLockManager({ navigatorOverride: fake.navigatorOverride });

    await m.acquire();
    expect(m.isDesired()).toBe(true);
    await m.release();

    expect(m.isHeld()).toBe(false);
    expect(m.isDesired()).toBe(false);
    expect(fake.sentinels[0]?.releaseCalled).toBe(true);
  });

  it("acquire() is idempotent: second call returns same held sentinel", async () => {
    const fake = makeFakeNavigator();
    const m = new WakeLockManager({ navigatorOverride: fake.navigatorOverride });

    const a = await m.acquire();
    const b = await m.acquire();

    expect(a).toBe(b);
    expect(fake.requestCalls).toHaveLength(1);
  });

  it("auto re-acquires on visibility return when intent persists", async () => {
    const fake = makeFakeNavigator();
    const m = new WakeLockManager({ navigatorOverride: fake.navigatorOverride });

    await m.acquire();
    expect(fake.sentinels).toHaveLength(1);

    // Simulate the spec-mandated auto-release on visibility hide:
    fake.sentinels[0]?.fireReleaseEvent();
    m.onVisibilityHidden();
    expect(m.isHeld()).toBe(false);
    expect(m.isDesired()).toBe(true);

    // Visibility returns — manager re-acquires.
    const s2 = await m.onVisibilityVisible();
    expect(s2).not.toBeNull();
    expect(fake.sentinels).toHaveLength(2);
    expect(m.isHeld()).toBe(true);
  });

  it("does NOT re-acquire on visibility return after explicit release()", async () => {
    const fake = makeFakeNavigator();
    const m = new WakeLockManager({ navigatorOverride: fake.navigatorOverride });

    await m.acquire();
    await m.release();
    const result = await m.onVisibilityVisible();

    expect(result).toBeNull();
    expect(fake.requestCalls).toHaveLength(1); // No second request.
  });

  it("returns null and warns once when navigator.wakeLock is unavailable", async () => {
    const warn = vi.fn();
    const m = new WakeLockManager({
      navigatorOverride: null,
      logger: { warn },
    });

    expect(await m.acquire()).toBeNull();
    expect(await m.acquire()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/wakeLock unavailable/);
  });

  it("returns null when request() throws (e.g. permission denied)", async () => {
    const fake = makeFakeNavigator();
    const warn = vi.fn();
    const m = new WakeLockManager({
      navigatorOverride: fake.navigatorOverride,
      logger: { warn },
    });

    fake.rejectNext("denied");
    const result = await m.acquire();

    expect(result).toBeNull();
    expect(m.isHeld()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("does not throw when release() called with nothing held", async () => {
    const m = new WakeLockManager({ navigatorOverride: null });
    await expect(m.release()).resolves.toBeUndefined();
  });
});
