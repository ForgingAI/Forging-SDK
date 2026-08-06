// `<Leaderboard />` — sorted scores from a named leaderboard.
//
// Reads `useLeaderboard(name)` and renders a ranked list. Animates score
// changes via a CSS transition on the row's transform/opacity (no animation
// library; compositor-friendly properties only per ~/.claude/rules/web).
//
// Note: because `useLeaderboard` is parameterized by the leaderboard name at
// the schema level, the consuming app must pass a literal string that matches
// a declared leaderboard. We accept `string` here for runtime flexibility and
// rely on the schema/hook layer for compile-time enforcement.

import { useMemo, type CSSProperties, type JSX } from "react";

import { useRoomAppContext } from "../runtime/react-context";
import type { LeaderboardEntry } from "../hooks/types";
import { colorFromId, resolveTheme, type ThemeTokens } from "./theme";

export interface LeaderboardProps {
  /** Declared leaderboard name. Must match a key in `defineRoom`'s leaderboards. */
  readonly name: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;
  readonly limit?: number;
  readonly direction?: "asc" | "desc";
  readonly showRank?: boolean;
  readonly emptyText?: string;
  /** Optional custom row renderer. Receives the full entry. */
  readonly renderEntry?: (entry: LeaderboardEntry<unknown>) => JSX.Element;
  /** Optional badge renderer reading off entry.metadata. */
  readonly renderBadge?: (
    metadata: unknown,
    entry: LeaderboardEntry<unknown>,
  ) => JSX.Element | null;
}

const DEFAULT_LIMIT = 10;

export function Leaderboard(props: LeaderboardProps): JSX.Element {
  const app = useRoomAppContext();
  // Cast: at runtime the bound hook accepts any declared leaderboard name; the
  // type-level constraint lives in the schema layer.
  const useLeaderboardHook = app.hooks.useLeaderboard as unknown as (
    name: string,
  ) => { readonly entries: readonly LeaderboardEntry<unknown>[] };
  const board = useLeaderboardHook(props.name);
  const theme = resolveTheme(props.theme);
  const limit = props.limit ?? DEFAULT_LIMIT;
  const direction = props.direction ?? "desc";
  const showRank = props.showRank ?? true;
  const emptyText = props.emptyText ?? "No scores yet";

  const sorted = useMemo(() => {
    const copy = [...board.entries];
    copy.sort((a, b) =>
      direction === "desc" ? b.score - a.score : a.score - b.score,
    );
    return copy.slice(0, limit);
  }, [board.entries, direction, limit]);

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spaceXS,
    padding: theme.spaceM,
    background: theme.colorSurface,
    color: theme.colorText,
    borderRadius: theme.radiusMedium,
    border: `1px solid ${theme.colorBorder}`,
    fontFamily: theme.fontFamily,
  };

  if (sorted.length === 0) {
    return (
      <div
        className={props.className}
        style={{ ...containerStyle, ...props.style }}
        role="status"
      >
        <span style={{ color: theme.colorTextMuted, fontStyle: "italic" }}>
          {emptyText}
        </span>
      </div>
    );
  }

  return (
    <ol
      className={props.className}
      style={{
        ...containerStyle,
        listStyle: "none",
        margin: 0,
        paddingLeft: theme.spaceM,
        paddingRight: theme.spaceM,
      }}
      aria-label={`Leaderboard: ${props.name}`}
    >
      {sorted.map((entry, index) => {
        const rank = direction === "desc" ? index + 1 : sorted.length - index;
        if (props.renderEntry) {
          return (
            <li key={entry.participantId}>{props.renderEntry(entry)}</li>
          );
        }
        return (
          <LeaderboardRow
            key={entry.participantId}
            entry={entry}
            rank={rank}
            theme={theme}
            showRank={showRank}
            {...(props.renderBadge ? { renderBadge: props.renderBadge } : {})}
          />
        );
      })}
    </ol>
  );
}

interface LeaderboardRowProps {
  readonly entry: LeaderboardEntry<unknown>;
  readonly rank: number;
  readonly theme: ThemeTokens;
  readonly showRank: boolean;
  readonly renderBadge?: (
    metadata: unknown,
    entry: LeaderboardEntry<unknown>,
  ) => JSX.Element | null;
}

function LeaderboardRow(props: LeaderboardRowProps): JSX.Element {
  const { entry, rank, theme, showRank, renderBadge } = props;
  const color = colorFromId(entry.participantId);
  const badge = renderBadge ? renderBadge(entry.metadata, entry) : null;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spaceM,
        minHeight: theme.tapTarget,
        padding: `${theme.spaceS} 0`,
        borderBottom: `1px solid ${theme.colorBorder}`,
        transition:
          "transform 240ms cubic-bezier(0.16,1,0.3,1), opacity 240ms",
      }}
    >
      {showRank ? (
        <span
          aria-hidden="true"
          style={{
            minWidth: 24,
            fontFamily: theme.fontMono,
            fontSize: "0.875rem",
            color: theme.colorTextMuted,
            textAlign: "right",
          }}
        >
          {rank}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {entry.displayName}
      </span>
      {badge}
      <span
        style={{
          fontFamily: theme.fontMono,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          transition: "color 240ms ease-out",
        }}
        aria-label={`Score ${entry.score}`}
      >
        {entry.score}
      </span>
    </li>
  );
}
