// `<HostControlPanel />` — host-only controls floating in the corner.
//
// Self-hides for participants by wrapping itself in `<HostOnly>`. On mobile,
// the panel docks to the bottom-right; on desktop it can be anchored elsewhere
// via the `position` prop or detached entirely (variant="inline").
//
// The phase transition buttons are derived from the room definition's
// `lifecycle` tuple plus an optional `nextPhases` allowlist from
// `useRoomLifecycle()`.

import { useMemo, useState, type CSSProperties, type JSX } from "react";

import { HostOnly } from "./role-gates";
import { useRoomAppContext } from "../runtime/react-context";
import { resolveTheme, type ThemeTokens } from "./theme";
import type { LifecyclePhase } from "../schema/define-room";

export interface HostControlPanelProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;
  readonly position?: "bottom-right" | "bottom-left" | "top-right" | "inline";
  /** Override or supplement the auto-derived phase buttons. */
  readonly phaseLabels?: Partial<Record<LifecyclePhase, string>>;
  /** Optional click handler before the SDK action runs. Return false to cancel. */
  readonly onAction?: (
    action: "setPhase" | "endRoom" | "kick",
    payload?: unknown,
  ) => boolean | void;
  /** When true, render an "End room" button. Default true. */
  readonly showEndRoom?: boolean;
  /** When provided, used as the panel title. Default "Host controls". */
  readonly title?: string;
}

export function HostControlPanel(
  props: HostControlPanelProps,
): JSX.Element | null {
  return (
    <HostOnly>
      <HostControlPanelInner {...props} />
    </HostOnly>
  );
}

function HostControlPanelInner(props: HostControlPanelProps): JSX.Element {
  const app = useRoomAppContext();
  const controls = app.hooks.useHostControls();
  const lifecycle = app.hooks.useRoomLifecycle();
  const theme = resolveTheme(props.theme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const position = props.position ?? "bottom-right";
  const showEndRoom = props.showEndRoom ?? true;
  const title = props.title ?? "Host controls";

  const allowed = useMemo<readonly LifecyclePhase[]>(
    () => lifecycle.allowed ?? [],
    [lifecycle.allowed],
  );

  if (!controls) return <></>;

  const handlePhase = async (phase: LifecyclePhase): Promise<void> => {
    if (busy) return;
    if (props.onAction && props.onAction("setPhase", phase) === false) return;
    setBusy(true);
    setError(null);
    try {
      await controls.setPhase(phase);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleEndRoom = async (): Promise<void> => {
    if (busy) return;
    if (props.onAction && props.onAction("endRoom") === false) return;
    setBusy(true);
    setError(null);
    try {
      await controls.endRoom();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const panelStyle: CSSProperties = {
    background: theme.colorSurface,
    color: theme.colorText,
    border: `1px solid ${theme.colorBorder}`,
    borderRadius: theme.radiusMedium,
    padding: theme.spaceM,
    fontFamily: theme.fontFamily,
    boxShadow: theme.shadowMedium,
    display: "flex",
    flexDirection: "column",
    gap: theme.spaceS,
    minWidth: 220,
    maxWidth: "min(92vw, 320px)",
    ...positionStyles(position, theme),
  };

  return (
    <section
      aria-label={title}
      className={props.className}
      style={{ ...panelStyle, ...props.style }}
    >
      <header
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: theme.colorTextMuted,
        }}
      >
        {title}
      </header>
      <div
        role="group"
        aria-label="Phase transitions"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: theme.spaceXS,
        }}
      >
        {allowed.length === 0 ? (
          <span style={{ color: theme.colorTextMuted, fontSize: "0.8rem" }}>
            No transitions available
          </span>
        ) : (
          allowed.map((phase) => (
            <PhaseButton
              key={phase}
              label={props.phaseLabels?.[phase] ?? defaultPhaseLabel(phase)}
              disabled={busy}
              onClick={() => {
                void handlePhase(phase);
              }}
              theme={theme}
            />
          ))
        )}
      </div>
      {showEndRoom ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleEndRoom();
          }}
          style={{
            minHeight: theme.tapTarget,
            padding: `${theme.spaceS} ${theme.spaceM}`,
            border: `1px solid ${theme.colorDanger}`,
            background: "transparent",
            color: theme.colorDanger,
            borderRadius: theme.radiusSmall,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          End room
        </button>
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{
            margin: 0,
            color: theme.colorDanger,
            fontSize: "0.8rem",
          }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

interface PhaseButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly theme: ThemeTokens;
}

function PhaseButton(props: PhaseButtonProps): JSX.Element {
  const { label, disabled, onClick, theme } = props;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: theme.tapTarget,
        padding: `${theme.spaceS} ${theme.spaceM}`,
        background: theme.colorAccent,
        color: theme.colorAccentText,
        border: "none",
        borderRadius: theme.radiusSmall,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        font: "inherit",
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function defaultPhaseLabel(phase: LifecyclePhase): string {
  switch (phase) {
    case "lobby":
      return "Return to lobby";
    case "active":
      return "Start";
    case "paused":
      return "Pause";
    case "ended":
      return "End";
    default:
      return phase;
  }
}

function positionStyles(
  position: NonNullable<HostControlPanelProps["position"]>,
  theme: ThemeTokens,
): CSSProperties {
  if (position === "inline") {
    return {};
  }
  const offset = theme.spaceM;
  const base: CSSProperties = { position: "fixed", zIndex: 100 };
  switch (position) {
    case "bottom-right":
      return { ...base, right: offset, bottom: offset };
    case "bottom-left":
      return { ...base, left: offset, bottom: offset };
    case "top-right":
      return { ...base, right: offset, top: offset };
    default:
      return base;
  }
}
