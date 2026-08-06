// `<JoinFlow />` — three-screen join flow (code → name → in-room).
//
// Precedent: Jackbox and Kahoot's "no signup, no download, just a code" flow
// (Research-1b Finding 7). Three screens managed by an internal state machine:
//
//   code-entry → name-entry → joining → joined | error
//
// Deep-link variants:
//   - Pass `codeFromUrl` to pre-fill the code input (or skip the screen via
//     `skipCodeEntry`).
//   - Pass `skipNameEntry` if the participant cookie already carries a display
//     name from a previous session.
//
// Slot model: the default reference UI is intentionally minimal. Consumers can
// override any of `CodeEntry`, `NameEntry`, `JoiningSpinner`, `ErrorView` to
// theme each screen without re-implementing the state machine. The default
// screens live in `./join-flow-screens.tsx`.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";

import type { RoomApp } from "../app/create-room-app";
import type { RoomDefinition } from "../schema/define-room";
import { resolveTheme, type ThemeTokens } from "./theme";
import {
  DefaultCodeEntry,
  DefaultErrorView,
  DefaultJoiningSpinner,
  DefaultNameEntry,
  normalizeCode,
  suggestName,
} from "./join-flow-screens";

export type JoinFlowPhase =
  | "code-entry"
  | "name-entry"
  | "joining"
  | "joined"
  | "error";

export interface JoinFlowProps<R extends RoomDefinition> {
  readonly app: RoomApp<R>;
  /** Children rendered after the join completes. Required. */
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;

  /** Optional consuming-app branding label above the join inputs. */
  readonly appName?: string;
  /** Optional welcome copy displayed on the code-entry screen. */
  readonly welcomeCopy?: string;

  /** Deep-link: pre-fill the code input. */
  readonly codeFromUrl?: string;
  /** Skip the code-entry screen entirely. */
  readonly skipCodeEntry?: boolean;
  /** Skip the name-entry screen (cookie already carries display name). */
  readonly skipNameEntry?: boolean;

  /** Fires when the participant successfully joins. */
  readonly onJoined?: () => void;
  /** Fires on every internal phase change for app-level theming/analytics. */
  readonly onPhaseChange?: (phase: JoinFlowPhase) => void;

  /**
   * Override the code-validation step. Default: validates client-side only.
   * Throw to fail validation (the error message will be displayed).
   */
  readonly onSubmitCode?: (code: string) => Promise<void> | void;

  /**
   * Override the name-submission step. Default: calls `app.connect()` then
   * settles to the "joined" state. Production apps should hit the
   * `POST /api/rooms/participants/cookie` endpoint here.
   */
  readonly onSubmitName?: (displayName: string) => Promise<void> | void;

  /** Optional slot overrides. */
  readonly CodeEntry?: (props: {
    readonly onSubmit: (code: string) => void;
    readonly error?: string;
    readonly initialValue?: string;
    readonly theme: ThemeTokens;
  }) => JSX.Element;
  readonly NameEntry?: (props: {
    readonly onSubmit: (name: string) => void;
    readonly error?: string;
    readonly suggestion?: string;
    readonly theme: ThemeTokens;
  }) => JSX.Element;
  readonly JoiningSpinner?: () => JSX.Element;
  readonly ErrorView?: (props: {
    readonly error: string;
    readonly retry: () => void;
    readonly theme: ThemeTokens;
  }) => JSX.Element;
}

const CODE_REGEX = /^[A-Z]{4}-[A-Z]{4}$/;
const NAME_MIN = 3;
const NAME_MAX = 24;
const NAME_REGEX = /^[\p{L}\p{N}\p{Emoji_Presentation}\p{Extended_Pictographic}\s'-]+$/u;

export function JoinFlow<R extends RoomDefinition>(
  props: JoinFlowProps<R>,
): JSX.Element {
  const theme = resolveTheme(props.theme);
  const initialPhase: JoinFlowPhase = computeInitialPhase(props);
  const [phase, setPhase] = useState<JoinFlowPhase>(initialPhase);
  const [code, setCode] = useState<string>(props.codeFromUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const suggestion = useMemo(() => suggestName(), []);

  const movePhase = useCallback(
    (next: JoinFlowPhase) => {
      setPhase(next);
      props.onPhaseChange?.(next);
    },
    [props],
  );

  // Notify on initial mount as well so analytics gets the starting phase.
  useEffect(() => {
    props.onPhaseChange?.(initialPhase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCodeSubmit = useCallback(
    async (input: string) => {
      const normalized = normalizeCode(input);
      if (!CODE_REGEX.test(normalized)) {
        setError("Enter a valid room code (e.g. PLUM-FROG).");
        return;
      }
      setError(null);
      setCode(normalized);
      try {
        if (props.onSubmitCode) {
          await props.onSubmitCode(normalized);
        }
        movePhase(props.skipNameEntry ? "joining" : "name-entry");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not find that room.");
        movePhase("error");
      }
    },
    [movePhase, props],
  );

  const handleNameSubmit = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
        setError(`Name must be ${NAME_MIN}-${NAME_MAX} characters.`);
        return;
      }
      if (!NAME_REGEX.test(trimmed)) {
        setError("Names can only contain letters, numbers, spaces, or emoji.");
        return;
      }
      setError(null);
      movePhase("joining");
      try {
        if (props.onSubmitName) {
          await props.onSubmitName(trimmed);
        } else {
          // Default: try to open the underlying RoomConnection. Production
          // apps should override this to POST to the participants endpoint
          // first, then trigger `app.connect()`.
          await props.app.connect();
        }
        movePhase("joined");
        props.onJoined?.();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not join the room.");
        movePhase("error");
      }
    },
    [movePhase, props],
  );

  // If the initial phase is already "joining" (skipCodeEntry + skipNameEntry),
  // run the default join flow once on mount.
  useEffect(() => {
    if (phase !== "joining") return;
    if (props.skipCodeEntry !== true || props.skipNameEntry !== true) return;
    let cancelled = false;
    (async () => {
      try {
        if (props.onSubmitName) {
          await props.onSubmitName("");
        } else {
          await props.app.connect();
        }
        if (!cancelled) {
          movePhase("joined");
          props.onJoined?.();
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not join the room.");
          movePhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "joined") {
    return <>{props.children}</>;
  }

  const wrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spaceL,
    minHeight: "100dvh",
    padding: theme.spaceL,
    background: theme.colorBg,
    color: theme.colorText,
    fontFamily: theme.fontFamily,
  };

  const errorText = error ?? undefined;
  let body: ReactNode;
  if (phase === "code-entry") {
    body = props.CodeEntry ? (
      props.CodeEntry({
        onSubmit: (v) => {
          void handleCodeSubmit(v);
        },
        ...(errorText !== undefined ? { error: errorText } : {}),
        ...(props.codeFromUrl ? { initialValue: props.codeFromUrl } : {}),
        theme,
      })
    ) : (
      <DefaultCodeEntry
        initialValue={props.codeFromUrl ?? ""}
        error={errorText}
        appName={props.appName}
        welcomeCopy={props.welcomeCopy}
        theme={theme}
        onSubmit={(v) => {
          void handleCodeSubmit(v);
        }}
      />
    );
  } else if (phase === "name-entry") {
    body = props.NameEntry ? (
      props.NameEntry({
        onSubmit: (v) => {
          void handleNameSubmit(v);
        },
        ...(errorText !== undefined ? { error: errorText } : {}),
        suggestion,
        theme,
      })
    ) : (
      <DefaultNameEntry
        code={code}
        suggestion={suggestion}
        error={errorText}
        theme={theme}
        onSubmit={(v) => {
          void handleNameSubmit(v);
        }}
      />
    );
  } else if (phase === "joining") {
    body = props.JoiningSpinner ? (
      props.JoiningSpinner()
    ) : (
      <DefaultJoiningSpinner theme={theme} />
    );
  } else {
    body = props.ErrorView ? (
      props.ErrorView({
        error: errorText ?? "Something went wrong.",
        retry: () => {
          setError(null);
          movePhase(props.skipCodeEntry ? "name-entry" : "code-entry");
        },
        theme,
      })
    ) : (
      <DefaultErrorView
        error={errorText ?? "Something went wrong."}
        theme={theme}
        onRetry={() => {
          setError(null);
          movePhase(props.skipCodeEntry ? "name-entry" : "code-entry");
        }}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Join the room"
      data-phase={phase}
      className={props.className}
      style={{ ...wrapperStyle, ...props.style }}
    >
      {body}
    </div>
  );
}

function computeInitialPhase<R extends RoomDefinition>(
  props: JoinFlowProps<R>,
): JoinFlowPhase {
  if (props.skipCodeEntry && props.skipNameEntry) return "joining";
  if (props.skipCodeEntry) return "name-entry";
  return "code-entry";
}
