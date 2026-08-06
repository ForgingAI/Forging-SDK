// Tests for the Phase-1 SDK components.
//
// Scope per task brief (1.2.6 + 1.2.8 + 1.2.9 acceptance):
//   - JoinFlow renders code-entry by default
//   - JoinFlow advances to name-entry on a valid code
//   - JoinFlow skips code-entry when `codeFromUrl` + `skipCodeEntry`
//   - HostOnly renders children when useHostControls returns non-null
//   - HostOnly renders fallback when null
//   - RoomCodeDisplay shows the code in the expected format
//   - StaleIndicator hidden when status=live; shown when reconnecting
//   - ReactionsOverlay caps at 20 simultaneous bursts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  HostOnly,
  JoinFlow,
  ReactionsOverlay,
  RoomCodeDisplay,
  StaleIndicator,
} from "../src/components/index";
import { RoomAppProvider } from "../src/runtime/react-context";
import { makeFakeRoomApp } from "./helpers/fake-room-app";

afterEach(() => {
  cleanup();
});

// ─── HostOnly ─────────────────────────────────────────────────────────────

describe("<HostOnly>", () => {
  it("renders children when useHostControls returns non-null", () => {
    const fake = makeFakeRoomApp({
      hostControls: {
        setPhase: vi.fn().mockResolvedValue(undefined),
        kick: vi.fn().mockResolvedValue(undefined),
        endRoom: vi.fn().mockResolvedValue(undefined),
      },
    });
    render(
      <RoomAppProvider app={fake.app}>
        <HostOnly fallback={<div>fallback</div>}>
          <div>host-only-content</div>
        </HostOnly>
      </RoomAppProvider>,
    );
    expect(screen.getByText("host-only-content")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("renders fallback when useHostControls returns null", () => {
    const fake = makeFakeRoomApp({ hostControls: null });
    render(
      <RoomAppProvider app={fake.app}>
        <HostOnly fallback={<div>fallback</div>}>
          <div>host-only-content</div>
        </HostOnly>
      </RoomAppProvider>,
    );
    expect(screen.queryByText("host-only-content")).toBeNull();
    expect(screen.getByText("fallback")).toBeTruthy();
  });

  it("renders nothing when participant has no fallback", () => {
    const fake = makeFakeRoomApp({ hostControls: null });
    const { container } = render(
      <RoomAppProvider app={fake.app}>
        <HostOnly>
          <div>secret</div>
        </HostOnly>
      </RoomAppProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

// ─── JoinFlow ─────────────────────────────────────────────────────────────

describe("<JoinFlow>", () => {
  it("renders the code-entry screen by default", () => {
    const fake = makeFakeRoomApp();
    render(
      <JoinFlow app={fake.app}>
        <div>in-room</div>
      </JoinFlow>,
    );
    const codeInput = screen.getByPlaceholderText("PLUM-FROG");
    expect(codeInput).toBeTruthy();
    expect(codeInput.getAttribute("inputMode")).toBe("text");
    expect(codeInput.getAttribute("maxLength")).toBe("9");
  });

  it("advances to the name-entry screen on valid code submit", async () => {
    const fake = makeFakeRoomApp();
    render(
      <JoinFlow app={fake.app}>
        <div>in-room</div>
      </JoinFlow>,
    );
    const codeInput = screen.getByPlaceholderText("PLUM-FROG") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "plumfrog" } });
    });
    expect(codeInput.value).toBe("PLUM-FROG");
    await act(async () => {
      fireEvent.submit(codeInput.closest("form")!);
    });
    expect(screen.getByText("Pick a name")).toBeTruthy();
  });

  it("rejects an invalid code and surfaces an error", async () => {
    const fake = makeFakeRoomApp();
    render(
      <JoinFlow app={fake.app}>
        <div>in-room</div>
      </JoinFlow>,
    );
    const codeInput = screen.getByPlaceholderText("PLUM-FROG") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "ab" } });
      fireEvent.submit(codeInput.closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/valid room code/i);
  });

  it("skips the code-entry screen when codeFromUrl + skipCodeEntry is set", () => {
    const fake = makeFakeRoomApp();
    render(
      <JoinFlow app={fake.app} codeFromUrl="BLUE-TIDE" skipCodeEntry={true}>
        <div>in-room</div>
      </JoinFlow>,
    );
    expect(screen.getByText("Pick a name")).toBeTruthy();
    expect(screen.queryByPlaceholderText("PLUM-FROG")).toBeNull();
  });

  it("renders children once the joined phase is reached", async () => {
    const fake = makeFakeRoomApp();
    const onJoined = vi.fn();
    render(
      <JoinFlow
        app={fake.app}
        codeFromUrl="BLUE-TIDE"
        skipCodeEntry={true}
        skipNameEntry={true}
        onJoined={onJoined}
      >
        <div>in-room-content</div>
      </JoinFlow>,
    );
    // The mount-time effect kicks the joining flow. Let microtasks settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fake.mocks.connect).toHaveBeenCalled();
    expect(screen.getByText("in-room-content")).toBeTruthy();
    expect(onJoined).toHaveBeenCalledTimes(1);
  });
});

// ─── RoomCodeDisplay ──────────────────────────────────────────────────────

describe("<RoomCodeDisplay>", () => {
  it("shows the room code in the expected format", () => {
    const fake = makeFakeRoomApp({
      roomMeta: { code: "PLUM-FROG", url: "https://example.test/r/PLUM-FROG" },
    });
    render(
      <RoomAppProvider app={fake.app}>
        <RoomCodeDisplay />
      </RoomAppProvider>,
    );
    expect(screen.getByText("PLUM-FROG")).toBeTruthy();
    expect(
      screen.getByText("https://example.test/r/PLUM-FROG"),
    ).toBeTruthy();
  });

  it("hides the URL when showUrl=false", () => {
    const fake = makeFakeRoomApp({
      roomMeta: { code: "PLUM-FROG", url: "https://example.test/r/PLUM-FROG" },
    });
    render(
      <RoomAppProvider app={fake.app}>
        <RoomCodeDisplay showUrl={false} />
      </RoomAppProvider>,
    );
    expect(
      screen.queryByText("https://example.test/r/PLUM-FROG"),
    ).toBeNull();
  });
});

// ─── StaleIndicator ───────────────────────────────────────────────────────

describe("<StaleIndicator>", () => {
  it("renders nothing when status is live", () => {
    const fake = makeFakeRoomApp({ roomMeta: { status: "live" } });
    const { container } = render(
      <RoomAppProvider app={fake.app}>
        <StaleIndicator />
      </RoomAppProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders a reconnecting message when status is reconnecting", () => {
    const fake = makeFakeRoomApp({ roomMeta: { status: "reconnecting" } });
    render(
      <RoomAppProvider app={fake.app}>
        <StaleIndicator />
      </RoomAppProvider>,
    );
    expect(screen.getByRole("status").textContent).toMatch(/reconnect/i);
  });

  it("renders a Retry button when status is disconnected", () => {
    const fake = makeFakeRoomApp({ roomMeta: { status: "disconnected" } });
    const onRetry = vi.fn();
    render(
      <RoomAppProvider app={fake.app}>
        <StaleIndicator onRetry={onRetry} />
      </RoomAppProvider>,
    );
    const btn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ─── ReactionsOverlay ─────────────────────────────────────────────────────

describe("<ReactionsOverlay>", () => {
  beforeEach(() => {
    // Stable seed so leftPct doesn't perturb counts.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a sprite for every fresh reaction up to the cap", () => {
    const now = Date.now();
    const reactions = Array.from({ length: 30 }, (_v, i) => ({
      emoji: "\u{1F389}",
      fromParticipantId: `p${i}`,
      at: now + i,
    }));
    const fake = makeFakeRoomApp({
      reactions: { send: vi.fn().mockResolvedValue(undefined), recent: reactions },
    });
    const { container } = render(
      <RoomAppProvider app={fake.app}>
        <ReactionsOverlay maxConcurrent={20} />
      </RoomAppProvider>,
    );
    // The overlay wrapper exposes a data-attribute we can assert on directly.
    const overlay = container.querySelector('[data-sprite-count]');
    expect(overlay).not.toBeNull();
    expect(Number(overlay!.getAttribute("data-sprite-count"))).toBe(20);
    // And the rendered span count should match.
    const sprites = overlay!.querySelectorAll('span[style*="position: absolute"]');
    expect(sprites.length).toBe(20);
  });
});
