// Default screen components for `<JoinFlow />`. Split out so `join-flow.tsx`
// stays focused on the state machine.
//
// Each default screen accepts the same callable shape as a consumer-provided
// slot override, so `<JoinFlow>` can pick either pathway uniformly.

import { useState, type CSSProperties, type JSX } from "react";

import type { ThemeTokens } from "./theme";

export const NAME_MAX = 24;

// ─── Code entry ───────────────────────────────────────────────────────────

export interface DefaultCodeEntryProps {
  readonly initialValue: string;
  readonly error?: string | undefined;
  readonly appName?: string | undefined;
  readonly welcomeCopy?: string | undefined;
  readonly theme: ThemeTokens;
  readonly onSubmit: (code: string) => void;
}

export function DefaultCodeEntry(props: DefaultCodeEntryProps): JSX.Element {
  const [value, setValue] = useState(props.initialValue);
  const { theme } = props;

  const handleChange = (raw: string): void => {
    setValue(normalizeCode(raw));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.spaceM,
        width: "100%",
        maxWidth: 360,
      }}
    >
      {props.appName ? (
        <h1
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
            color: theme.colorTextMuted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {props.appName}
        </h1>
      ) : null}
      <h2
        style={{
          margin: 0,
          fontSize: "1.75rem",
          fontWeight: 700,
          color: theme.colorText,
          textAlign: "center",
        }}
      >
        {props.welcomeCopy ?? "Enter room code"}
      </h2>
      <label htmlFor="forging-rooms-code" style={{ width: "100%" }}>
        <span
          style={{
            display: "block",
            marginBottom: theme.spaceXS,
            color: theme.colorTextMuted,
            fontSize: "0.85rem",
          }}
        >
          Room code
        </span>
        <input
          id="forging-rooms-code"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          pattern="[A-Z]{4}-[A-Z]{4}"
          maxLength={9}
          value={value}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? "forging-rooms-code-error" : undefined}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="PLUM-FROG"
          style={{
            width: "100%",
            minHeight: theme.tapTarget,
            padding: `${theme.spaceM} ${theme.spaceM}`,
            fontFamily: theme.fontMono,
            fontSize: "1.5rem",
            letterSpacing: "0.16em",
            textAlign: "center",
            textTransform: "uppercase",
            background: theme.colorSurface,
            color: theme.colorText,
            border: `1px solid ${
              props.error ? theme.colorDanger : theme.colorBorder
            }`,
            borderRadius: theme.radiusMedium,
            outlineColor: theme.colorAccent,
          }}
        />
      </label>
      {props.error ? (
        <p
          id="forging-rooms-code-error"
          role="alert"
          style={{ margin: 0, color: theme.colorDanger, fontSize: "0.85rem" }}
        >
          {props.error}
        </p>
      ) : null}
      <button type="submit" style={primaryButtonStyle(theme)}>
        Continue
      </button>
    </form>
  );
}

// ─── Name entry ───────────────────────────────────────────────────────────

export interface DefaultNameEntryProps {
  readonly code: string;
  readonly suggestion: string;
  readonly error?: string | undefined;
  readonly theme: ThemeTokens;
  readonly onSubmit: (name: string) => void;
}

export function DefaultNameEntry(props: DefaultNameEntryProps): JSX.Element {
  const [value, setValue] = useState("");
  const { theme } = props;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value || props.suggestion);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.spaceM,
        width: "100%",
        maxWidth: 360,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "1.5rem",
          fontWeight: 700,
          color: theme.colorText,
          textAlign: "center",
        }}
      >
        Pick a name
      </h2>
      {props.code ? (
        <span style={{ color: theme.colorTextMuted, fontSize: "0.85rem" }}>
          Joining {props.code}
        </span>
      ) : null}
      <label htmlFor="forging-rooms-name" style={{ width: "100%" }}>
        <span
          style={{
            display: "block",
            marginBottom: theme.spaceXS,
            color: theme.colorTextMuted,
            fontSize: "0.85rem",
          }}
        >
          Display name
        </span>
        <input
          id="forging-rooms-name"
          type="text"
          inputMode="text"
          autoComplete="nickname"
          maxLength={NAME_MAX}
          value={value}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? "forging-rooms-name-error" : undefined}
          onChange={(e) => setValue(e.target.value)}
          placeholder={props.suggestion}
          style={{
            width: "100%",
            minHeight: theme.tapTarget,
            padding: `${theme.spaceM} ${theme.spaceM}`,
            fontFamily: theme.fontFamily,
            fontSize: "1.125rem",
            background: theme.colorSurface,
            color: theme.colorText,
            border: `1px solid ${
              props.error ? theme.colorDanger : theme.colorBorder
            }`,
            borderRadius: theme.radiusMedium,
            outlineColor: theme.colorAccent,
          }}
        />
      </label>
      {props.error ? (
        <p
          id="forging-rooms-name-error"
          role="alert"
          style={{ margin: 0, color: theme.colorDanger, fontSize: "0.85rem" }}
        >
          {props.error}
        </p>
      ) : null}
      <button type="submit" style={primaryButtonStyle(theme)}>
        Join
      </button>
    </form>
  );
}

// ─── Joining + error ──────────────────────────────────────────────────────

export function DefaultJoiningSpinner(props: {
  readonly theme: ThemeTokens;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: props.theme.spaceM,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          border: `3px solid ${props.theme.colorAccent}`,
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "forging-rooms-spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes forging-rooms-spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ color: props.theme.colorTextMuted }}>Joining…</span>
    </div>
  );
}

export interface DefaultErrorViewProps {
  readonly error: string;
  readonly theme: ThemeTokens;
  readonly onRetry: () => void;
}

export function DefaultErrorView(props: DefaultErrorViewProps): JSX.Element {
  const { theme } = props;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.spaceM,
        maxWidth: 360,
        textAlign: "center",
      }}
    >
      <h2 style={{ margin: 0, color: theme.colorDanger, fontSize: "1.25rem" }}>
        Couldn't join
      </h2>
      <p style={{ margin: 0, color: theme.colorTextMuted }}>{props.error}</p>
      <button
        type="button"
        onClick={props.onRetry}
        style={primaryButtonStyle(theme)}
      >
        Try again
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function primaryButtonStyle(theme: ThemeTokens): CSSProperties {
  return {
    minHeight: theme.tapTarget,
    width: "100%",
    padding: `${theme.spaceM} ${theme.spaceL}`,
    background: theme.colorAccent,
    color: theme.colorAccentText,
    border: "none",
    borderRadius: theme.radiusMedium,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    fontSize: "1rem",
  };
}

export function normalizeCode(raw: string): string {
  const lettersOnly = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const clipped = lettersOnly.slice(0, 8);
  if (clipped.length <= 4) return clipped;
  return `${clipped.slice(0, 4)}-${clipped.slice(4)}`;
}

const ADJECTIVES = [
  "Plum",
  "Tidy",
  "Swift",
  "Curious",
  "Sunny",
  "Brave",
  "Witty",
  "Lucky",
  "Mellow",
  "Bright",
] as const;

const ANIMALS = [
  "Frog",
  "Otter",
  "Hawk",
  "Panda",
  "Newt",
  "Bear",
  "Cat",
  "Fox",
  "Mole",
  "Lynx",
] as const;

export function suggestName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] ?? "Plum";
  const an = ANIMALS[Math.floor(Math.random() * ANIMALS.length)] ?? "Frog";
  return `${a}${an}${Math.floor(Math.random() * 90) + 10}`;
}
