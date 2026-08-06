// `<StaleIndicator />` — surfaces connection health without modal disruption.
//
// Renders:
//   - nothing            when status === "live" or "idle"
//   - "Reconnecting…"    when status is "connecting" / "reconnecting" / "replaying"
//   - "Disconnected"     when status === "disconnected" (terminal — show Retry)
//
// Position is configurable: top-banner by default (mobile-friendly), or
// bottom-banner, or inline so a layout can place it next to other status.

import { useMemo, type CSSProperties, type JSX } from "react";

import { useRoomAppContext } from "../runtime/react-context";
import type { ConnectionStatus } from "../hooks/types";
import { resolveTheme, type ThemeTokens } from "./theme";

export interface StaleIndicatorProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;
  readonly position?: "top" | "bottom" | "inline";
  /** Optional override text. Keys are connection statuses. */
  readonly copy?: Partial<Record<ConnectionStatus, string>>;
  /** Optional callback invoked when the user clicks the retry button. */
  readonly onRetry?: () => void;
}

const DEFAULT_COPY: Readonly<Record<ConnectionStatus, string>> = {
  idle: "",
  connecting: "Connecting…",
  live: "",
  replaying: "Resyncing…",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected. Refresh to reconnect.",
};

export function StaleIndicator(props: StaleIndicatorProps): JSX.Element | null {
  const app = useRoomAppContext();
  const room = app.hooks.useRoom();
  const theme = resolveTheme(props.theme);
  const status: ConnectionStatus = room.status;
  const position = props.position ?? "top";

  const text =
    (props.copy && props.copy[status]) ?? DEFAULT_COPY[status] ?? "";

  const containerStyle = useMemo<CSSProperties>(() => {
    const base: CSSProperties = {
      fontFamily: theme.fontFamily,
      background:
        status === "disconnected" ? theme.colorDanger : theme.colorSurface,
      color:
        status === "disconnected" ? theme.colorAccentText : theme.colorText,
      padding: `${theme.spaceS} ${theme.spaceM}`,
      borderRadius:
        position === "inline" ? theme.radiusMedium : theme.radiusSmall,
      display: "flex",
      alignItems: "center",
      gap: theme.spaceS,
      boxShadow: position === "inline" ? "none" : theme.shadowMedium,
      fontSize: "0.875rem",
      lineHeight: 1.4,
      zIndex: 999,
    };
    if (position === "top") {
      return {
        ...base,
        position: "fixed",
        top: theme.spaceM,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(92vw, 480px)",
      };
    }
    if (position === "bottom") {
      return {
        ...base,
        position: "fixed",
        bottom: theme.spaceM,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(92vw, 480px)",
      };
    }
    return base;
  }, [position, status, theme]);

  if (status === "live" || status === "idle" || !text) {
    return null;
  }

  const showSpinner =
    status === "connecting" ||
    status === "reconnecting" ||
    status === "replaying";

  return (
    <div
      role="status"
      aria-live="polite"
      data-status={status}
      className={props.className}
      style={{ ...containerStyle, ...props.style }}
    >
      {showSpinner ? <Spinner color={theme.colorAccentText} /> : null}
      <span>{text}</span>
      {status === "disconnected" ? (
        <button
          type="button"
          onClick={props.onRetry}
          style={{
            minHeight: theme.tapTarget,
            minWidth: theme.tapTarget,
            padding: `${theme.spaceXS} ${theme.spaceM}`,
            borderRadius: theme.radiusSmall,
            border: `1px solid ${theme.colorAccentText}`,
            background: "transparent",
            color: theme.colorAccentText,
            cursor: "pointer",
            font: "inherit",
          }}
          aria-label="Retry connection"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function Spinner(props: { readonly color: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        border: `2px solid ${props.color}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "forging-rooms-spin 0.9s linear infinite",
      }}
    >
      <style>{spinnerKeyframes}</style>
    </span>
  );
}

const spinnerKeyframes = `
@keyframes forging-rooms-spin {
  to { transform: rotate(360deg); }
}
`;
