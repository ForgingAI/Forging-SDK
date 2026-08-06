// Shared theme tokens for the SDK's reference UI.
//
// All components accept `theme?: Partial<ThemeTokens>` and merge it onto the
// default neutral palette so consuming apps can theme without reaching for a
// CSS-in-JS framework. Keep the surface tiny — the design contract is
// "unstyled-by-default with sensible neutral defaults" (per spec).

import type { CSSProperties } from "react";

export interface ThemeTokens {
  readonly colorBg: string;
  readonly colorSurface: string;
  readonly colorText: string;
  readonly colorTextMuted: string;
  readonly colorBorder: string;
  readonly colorAccent: string;
  readonly colorAccentText: string;
  readonly colorDanger: string;
  readonly colorOnline: string;
  readonly colorOffline: string;
  readonly fontFamily: string;
  readonly fontMono: string;
  readonly radiusSmall: string;
  readonly radiusMedium: string;
  readonly radiusLarge: string;
  readonly spaceXS: string;
  readonly spaceS: string;
  readonly spaceM: string;
  readonly spaceL: string;
  readonly spaceXL: string;
  readonly tapTarget: string;
  readonly shadowMedium: string;
}

export const defaultTheme: ThemeTokens = Object.freeze({
  colorBg: "#0b0c10",
  colorSurface: "#16181d",
  colorText: "#e6e8eb",
  colorTextMuted: "#9aa0a6",
  colorBorder: "rgba(255,255,255,0.10)",
  colorAccent: "#5b8def",
  colorAccentText: "#ffffff",
  colorDanger: "#e5484d",
  colorOnline: "#3ecf8e",
  colorOffline: "#6b7280",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontMono:
    "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace",
  radiusSmall: "6px",
  radiusMedium: "10px",
  radiusLarge: "16px",
  spaceXS: "4px",
  spaceS: "8px",
  spaceM: "12px",
  spaceL: "20px",
  spaceXL: "32px",
  tapTarget: "44px",
  shadowMedium: "0 4px 16px rgba(0,0,0,0.32)",
});

/** Merge a partial theme over the defaults. Pure / immutable. */
export function resolveTheme(partial?: Partial<ThemeTokens>): ThemeTokens {
  if (!partial) return defaultTheme;
  return { ...defaultTheme, ...partial };
}

/**
 * Deterministic avatar/badge color derived from a participant id.
 * Output is in the OKLCH-ish HSL space but uses HSL so we don't depend on a
 * modern-browser color space. Keeps text contrast reasonable across hashes.
 */
export function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 62% 48%)`;
}

/** Visually-hidden style for screen-reader-only text. */
export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};
