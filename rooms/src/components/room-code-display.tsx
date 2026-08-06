// `<RoomCodeDisplay />` — big shareable code + URL + optional QR + share button.
//
// The Web Share API is used on platforms that expose it (most mobile UAs);
// desktop falls back to `navigator.clipboard.writeText`.
//
// QR rendering note: a zero-dependency QR encoder is ~300 lines of bit-pushing
// math and we don't want to vendor that into the SDK in Phase 1. Instead, we
// expose a `renderQR?: (data: string) => ReactNode` slot prop. The consuming
// app can pass `qrcode.react`'s `<QRCodeSVG>` or any other encoder. If no slot
// is provided, the QR area is omitted gracefully.

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";

import { useRoomAppContext } from "../runtime/react-context";
import { resolveTheme, type ThemeTokens, visuallyHidden } from "./theme";

export interface RoomCodeDisplayProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly theme?: Partial<ThemeTokens>;
  readonly size?: "small" | "medium" | "large";
  /** Show the underlying URL beneath the code. Default true. */
  readonly showUrl?: boolean;
  /** Show a Share / Copy button. Default true. */
  readonly showShareButton?: boolean;
  /** Optional QR renderer slot. Receives the share URL as its argument. */
  readonly renderQR?: (data: string) => ReactNode;
  /** Optional title above the code (e.g., "Join at"). */
  readonly title?: string;
  /** Optional override for the share payload's title. */
  readonly shareTitle?: string;
  /** Optional override for the share payload's text. */
  readonly shareText?: string;
}

interface SizeTokens {
  readonly codeFontSize: string;
  readonly codeLetterSpacing: string;
  readonly urlFontSize: string;
  readonly qrSize: number;
  readonly padding: string;
}

function tokensFor(size: NonNullable<RoomCodeDisplayProps["size"]>): SizeTokens {
  switch (size) {
    case "small":
      return {
        codeFontSize: "1.75rem",
        codeLetterSpacing: "0.08em",
        urlFontSize: "0.75rem",
        qrSize: 96,
        padding: "12px",
      };
    case "medium":
      return {
        codeFontSize: "2.75rem",
        codeLetterSpacing: "0.12em",
        urlFontSize: "0.875rem",
        qrSize: 144,
        padding: "16px",
      };
    case "large":
    default:
      return {
        codeFontSize: "4rem",
        codeLetterSpacing: "0.16em",
        urlFontSize: "1rem",
        qrSize: 192,
        padding: "24px",
      };
  }
}

export function RoomCodeDisplay(props: RoomCodeDisplayProps): JSX.Element {
  const app = useRoomAppContext();
  const room = app.hooks.useRoom();
  const theme = resolveTheme(props.theme);
  const size = props.size ?? "large";
  const sizeTokens = useMemo(() => tokensFor(size), [size]);
  const [copied, setCopied] = useState(false);

  const code = room.code;
  const url = room.url;
  const showUrl = props.showUrl ?? true;
  const showShareButton = props.showShareButton ?? true;

  const handleShare = useCallback(async (): Promise<void> => {
    if (typeof navigator === "undefined") return;
    const payload: ShareData = {
      title: props.shareTitle ?? "Join the room",
      text:
        props.shareText ??
        `Join with code ${code}`,
      url,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // User cancelled or share unavailable — fall through to clipboard.
      }
    }
    if (
      typeof navigator.clipboard !== "undefined" &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // Last-resort: no-op. Consumers can override via custom UI.
      }
    }
  }, [code, url, props.shareTitle, props.shareText]);

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: theme.spaceM,
    padding: sizeTokens.padding,
    fontFamily: theme.fontFamily,
    color: theme.colorText,
    background: theme.colorSurface,
    borderRadius: theme.radiusLarge,
    border: `1px solid ${theme.colorBorder}`,
    maxWidth: "fit-content",
  };

  return (
    <section
      aria-label="Room invite"
      className={props.className}
      style={{ ...containerStyle, ...props.style }}
    >
      {props.title ? (
        <span
          style={{
            fontSize: "0.875rem",
            color: theme.colorTextMuted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {props.title}
        </span>
      ) : null}
      <div
        role="text"
        aria-label={`Room code ${spaceForScreenReader(code)}`}
        style={{
          fontFamily: theme.fontMono,
          fontSize: sizeTokens.codeFontSize,
          letterSpacing: sizeTokens.codeLetterSpacing,
          fontWeight: 700,
          lineHeight: 1,
          color: theme.colorText,
          userSelect: "all",
        }}
      >
        {code}
      </div>
      {showUrl ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: sizeTokens.urlFontSize,
            color: theme.colorTextMuted,
            textDecoration: "none",
            wordBreak: "break-all",
            textAlign: "center",
          }}
        >
          {url}
        </a>
      ) : null}
      {props.renderQR ? (
        <div
          aria-hidden="true"
          style={{
            width: sizeTokens.qrSize,
            height: sizeTokens.qrSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
            padding: theme.spaceS,
            borderRadius: theme.radiusSmall,
          }}
        >
          {props.renderQR(url)}
        </div>
      ) : null}
      {showShareButton ? (
        <button
          type="button"
          onClick={() => {
            void handleShare();
          }}
          aria-label="Share room invite"
          style={{
            minHeight: theme.tapTarget,
            padding: `${theme.spaceS} ${theme.spaceL}`,
            border: "none",
            borderRadius: theme.radiusSmall,
            background: theme.colorAccent,
            color: theme.colorAccentText,
            cursor: "pointer",
            font: "inherit",
            fontWeight: 600,
          }}
        >
          {copied ? "Copied!" : "Share"}
          <span style={visuallyHidden}>
            {copied ? "Link copied to clipboard" : "Open share sheet"}
          </span>
        </button>
      ) : null}
    </section>
  );
}

function spaceForScreenReader(code: string): string {
  // "PLUM-FROG" → "P L U M dash F R O G" reads better with a screen reader.
  return code
    .split("")
    .map((ch) => (ch === "-" ? "dash" : ch))
    .join(" ");
}
