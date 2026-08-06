// `<PresenceStrip />` — horizontal (or grid) display of connected participants.
//
// Reads from `useRoomPresence()` and renders an avatar + name per participant.
// Host gets a crown badge; offline participants are visually muted; overflow
// collapses to a `+N more` chip when `maxVisible` is exceeded.

import { useMemo, type CSSProperties, type JSX } from "react";

import { useRoomAppContext } from "../runtime/react-context";
import type { PresenceParticipant } from "../hooks/types";
import { colorFromId, resolveTheme, type ThemeTokens } from "./theme";

export interface PresenceStripProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;
  readonly maxVisible?: number;
  readonly layout?: "strip" | "grid";
  /** When true, host gets a small crown badge. Default true. */
  readonly showHostBadge?: boolean;
  /** Optional click handler — receives the clicked participant. */
  readonly onParticipantClick?: (p: PresenceParticipant) => void;
}

const AVATAR_SIZE = 40;

export function PresenceStrip(props: PresenceStripProps): JSX.Element {
  const app = useRoomAppContext();
  const participants = app.hooks.useRoomPresence();
  const theme = resolveTheme(props.theme);
  const maxVisible = props.maxVisible ?? 8;
  const layout = props.layout ?? "strip";
  const showHostBadge = props.showHostBadge ?? true;

  const { visible, overflow } = useMemo(() => {
    if (participants.length <= maxVisible) {
      return { visible: participants, overflow: 0 };
    }
    return {
      visible: participants.slice(0, maxVisible),
      overflow: participants.length - maxVisible,
    };
  }, [participants, maxVisible]);

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    flexWrap: layout === "grid" ? "wrap" : "nowrap",
    gap: theme.spaceS,
    alignItems: "center",
    overflowX: layout === "strip" ? "auto" : "visible",
    paddingBottom: layout === "strip" ? theme.spaceXS : 0,
    fontFamily: theme.fontFamily,
    color: theme.colorText,
  };

  return (
    <div
      role="list"
      aria-label="Participants"
      className={props.className}
      style={{ ...containerStyle, ...props.style }}
    >
      {visible.map((participant) => (
        <ParticipantAvatar
          key={participant.participantId}
          participant={participant}
          theme={theme}
          showHostBadge={showHostBadge}
          {...(props.onParticipantClick
            ? { onClick: props.onParticipantClick }
            : {})}
        />
      ))}
      {overflow > 0 ? (
        <div
          role="listitem"
          aria-label={`${overflow} more participants`}
          style={{
            minWidth: AVATAR_SIZE,
            minHeight: AVATAR_SIZE,
            padding: `0 ${theme.spaceS}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: theme.colorSurface,
            color: theme.colorTextMuted,
            border: `1px solid ${theme.colorBorder}`,
            borderRadius: theme.radiusLarge,
            fontSize: "0.75rem",
            whiteSpace: "nowrap",
          }}
        >
          +{overflow} more
        </div>
      ) : null}
    </div>
  );
}

interface ParticipantAvatarProps {
  readonly participant: PresenceParticipant;
  readonly theme: ThemeTokens;
  readonly showHostBadge: boolean;
  readonly onClick?: (p: PresenceParticipant) => void;
}

function ParticipantAvatar(props: ParticipantAvatarProps): JSX.Element {
  const { participant, theme, showHostBadge, onClick } = props;
  const color = colorFromId(participant.participantId);
  const initials = getInitials(participant.displayName);
  const isInteractive = onClick !== undefined;
  const isOffline = !participant.online;

  return (
    <button
      type="button"
      role="listitem"
      aria-label={`${participant.displayName}${
        participant.role === "host" ? ", host" : ""
      }${isOffline ? ", offline" : ", online"}`}
      onClick={isInteractive ? () => onClick(participant) : undefined}
      disabled={!isInteractive}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.spaceXS,
        minWidth: AVATAR_SIZE,
        minHeight: theme.tapTarget,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: isInteractive ? "pointer" : "default",
        color: "inherit",
        opacity: isOffline ? 0.45 : 1,
        filter: isOffline ? "grayscale(0.6)" : "none",
        font: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: "50%",
          background: color,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: "0.875rem",
          letterSpacing: "0.04em",
        }}
      >
        {initials}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: -2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: isOffline ? theme.colorOffline : theme.colorOnline,
          border: `2px solid ${theme.colorBg}`,
        }}
      />
      {showHostBadge && participant.role === "host" ? (
        <span
          aria-hidden="true"
          title="Host"
          style={{
            position: "absolute",
            top: -6,
            left: -2,
            fontSize: "14px",
            lineHeight: 1,
            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.45))",
          }}
        >
          {"\u{1F451}"}
        </span>
      ) : null}
      <span
        style={{
          fontSize: "0.75rem",
          maxWidth: "84px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: theme.colorTextMuted,
        }}
      >
        {participant.displayName}
      </span>
    </button>
  );
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts
    .map((p) => Array.from(p)[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
