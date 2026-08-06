// VisibilityCoordinator tests (task 1.2.10).
//
// Covers:
//   - Rapid hide+show (< threshold) → onHidden + onVisible fire, but
//     onVisibleRecovery does NOT fire.
//   - Hide+show > threshold → onVisibleRecovery fires with the elapsed duration.
//   - `pagehide` → onPageHide fires.
//   - `pageshow` with persisted=true → onPageShow fires with persisted=true.
//   - stop() unsubscribes; subsequent fires do nothing.
//
// We mock `document` and `window` directly. The coordinator's constructor
// accepts overrides so we don't need jsdom.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   Sub-track 1.2 task 1.2.10.

import { describe, expect, it, vi } from "vitest";

import { VisibilityCoordinator } from "../src/runtime/visibility";

// ─── Test fakes ────────────────────────────────────────────────────────────

interface FakeDoc {
  visibilityState: "visible" | "hidden";
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  /** Drive a visibility transition. */
  setVisibility(state: "visible" | "hidden"): void;
  listenerCount(type: string): number;
}

function makeFakeDoc(): FakeDoc {
  const listeners: Map<string, Array<() => void>> = new Map();
  const doc: FakeDoc = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type, listener) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    },
    setVisibility(state) {
      doc.visibilityState = state;
      const arr = listeners.get("visibilitychange") ?? [];
      for (const l of arr) l();
    },
    listenerCount(type) {
      return listeners.get(type)?.length ?? 0;
    },
  };
  return doc;
}

interface FakeWin {
  addEventListener: (type: string, listener: (ev: unknown) => void) => void;
  removeEventListener: (type: string, listener: (ev: unknown) => void) => void;
  fire(type: string, ev?: unknown): void;
  listenerCount(type: string): number;
}

function makeFakeWin(): FakeWin {
  const listeners: Map<string, Array<(ev: unknown) => void>> = new Map();
  return {
    addEventListener(type, listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type, listener) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    },
    fire(type, ev) {
      const arr = listeners.get(type) ?? [];
      for (const l of arr) l(ev);
    },
    listenerCount(type) {
      return listeners.get(type)?.length ?? 0;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VisibilityCoordinator", () => {
  it("subscribes only after start() and unsubscribes on stop()", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });

    expect(doc.listenerCount("visibilitychange")).toBe(0);
    vc.start();
    expect(doc.listenerCount("visibilitychange")).toBe(1);
    expect(win.listenerCount("pagehide")).toBe(1);
    expect(win.listenerCount("pageshow")).toBe(1);

    vc.stop();
    expect(doc.listenerCount("visibilitychange")).toBe(0);
    expect(win.listenerCount("pagehide")).toBe(0);
    expect(win.listenerCount("pageshow")).toBe(0);
  });

  it("does NOT fire onVisibleRecovery for hides under the threshold (5s default)", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    let now = 1_000_000;
    const onHidden = vi.fn();
    const onVisible = vi.fn();
    const onVisibleRecovery = vi.fn();

    const vc = new VisibilityCoordinator({
      documentOverride: doc,
      windowOverride: win,
      nowFn: () => now,
    });
    vc.setCallbacks({ onHidden, onVisible, onVisibleRecovery });
    vc.start();

    doc.setVisibility("hidden");
    expect(onHidden).toHaveBeenCalledTimes(1);

    // 800 ms later — way under threshold.
    now += 800;
    doc.setVisibility("visible");

    expect(onVisible).toHaveBeenCalledTimes(1);
    expect(onVisible).toHaveBeenCalledWith(800);
    expect(onVisibleRecovery).not.toHaveBeenCalled();
  });

  it("FIRES onVisibleRecovery when hide duration meets/exceeds the threshold", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    let now = 1_000_000;
    const onVisibleRecovery = vi.fn();

    const vc = new VisibilityCoordinator({
      documentOverride: doc,
      windowOverride: win,
      nowFn: () => now,
    });
    vc.setCallbacks({ onVisibleRecovery });
    vc.start();

    doc.setVisibility("hidden");
    now += 5_001;
    doc.setVisibility("visible");

    expect(onVisibleRecovery).toHaveBeenCalledTimes(1);
    expect(onVisibleRecovery).toHaveBeenCalledWith(5_001);
  });

  it("honors a custom threshold via options", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    let now = 0;
    const onVisibleRecovery = vi.fn();

    const vc = new VisibilityCoordinator({
      documentOverride: doc,
      windowOverride: win,
      nowFn: () => now,
      hiddenRecoveryThresholdMs: 1_000,
    });
    vc.setCallbacks({ onVisibleRecovery });
    vc.start();

    doc.setVisibility("hidden");
    now += 999;
    doc.setVisibility("visible");
    expect(onVisibleRecovery).not.toHaveBeenCalled();

    doc.setVisibility("hidden");
    now += 1_000;
    doc.setVisibility("visible");
    expect(onVisibleRecovery).toHaveBeenCalledTimes(1);
    expect(onVisibleRecovery).toHaveBeenCalledWith(1_000);
  });

  it("fires onPageHide on pagehide", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const onPageHide = vi.fn();

    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });
    vc.setCallbacks({ onPageHide });
    vc.start();

    win.fire("pagehide");
    expect(onPageHide).toHaveBeenCalledTimes(1);
  });

  it("fires onPageShow with persisted=true when the bfcache restores the page", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const onPageShow = vi.fn();

    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });
    vc.setCallbacks({ onPageShow });
    vc.start();

    win.fire("pageshow", { persisted: true });
    win.fire("pageshow", { persisted: false });

    expect(onPageShow).toHaveBeenCalledTimes(2);
    expect(onPageShow.mock.calls[0]?.[0]).toEqual({ persisted: true });
    expect(onPageShow.mock.calls[1]?.[0]).toEqual({ persisted: false });
  });

  it("defaults persisted to false when event is missing the field", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const onPageShow = vi.fn();

    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });
    vc.setCallbacks({ onPageShow });
    vc.start();

    win.fire("pageshow", {});
    expect(onPageShow).toHaveBeenCalledWith({ persisted: false });
  });

  it("start() is idempotent", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });

    vc.start();
    vc.start();
    expect(doc.listenerCount("visibilitychange")).toBe(1);
  });

  it("stop() before start() is a no-op (does not throw)", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });
    expect(() => vc.stop()).not.toThrow();
  });

  it("setCallbacks() takes a snapshot — callers can't mutate the live map", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const onHidden = vi.fn();
    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });

    const cbs = { onHidden };
    vc.setCallbacks(cbs);
    vc.start();
    // Mutating the caller's object after-the-fact should not change behavior.
    (cbs as { onHidden?: () => void }).onHidden = vi.fn();
    doc.setVisibility("hidden");
    expect(onHidden).toHaveBeenCalledTimes(1);
  });
});

describe("VisibilityCoordinator + offline beacon (integration shape)", () => {
  // Spot-check that the connection layer's onPageHide hook is wired to fire
  // a beacon. We don't import RoomConnection here (kept light) — that
  // integration is exercised in runtime.test.ts. This test just guards the
  // VisibilityCoordinator end of the contract.
  it("forwards pagehide events even when document is hidden", () => {
    const doc = makeFakeDoc();
    const win = makeFakeWin();
    const onPageHide = vi.fn();
    const vc = new VisibilityCoordinator({ documentOverride: doc, windowOverride: win });
    vc.setCallbacks({ onPageHide });
    vc.start();

    doc.setVisibility("hidden");
    win.fire("pagehide");
    expect(onPageHide).toHaveBeenCalledTimes(1);
  });
});
