// `<ReactionsOverlay />` — floating emoji bursts driven by `useReactions()`.
//
// Rendering strategy:
//   - subscribes to the most recent reaction events
//   - each new reaction yields a transient sprite that floats up and fades
//   - sprites self-expire after `durationMs` (default 1500ms)
//   - hard cap of `maxConcurrent` (default 20) sprites; oldest dropped first
//   - pointer-events: none so the overlay never blocks underlying UI
//
// Animation uses CSS keyframes on `transform` + `opacity` only — compositor
// friendly per ~/.claude/rules/web/performance.md.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";

import { useRoomAppContext } from "../runtime/react-context";

export interface ReactionsOverlayProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly maxConcurrent?: number;
  readonly durationMs?: number;
  /** Optional override to disable when accessibility prefers reduced motion. */
  readonly respectReducedMotion?: boolean;
}

interface Sprite {
  readonly id: string;
  readonly emoji: string;
  readonly leftPct: number;
  readonly startedAt: number;
}

const DEFAULT_MAX = 20;
const DEFAULT_DURATION_MS = 1500;

let spriteSeq = 0;
function nextSpriteId(): string {
  spriteSeq += 1;
  return `r${spriteSeq}-${Date.now().toString(36)}`;
}

export function ReactionsOverlay(props: ReactionsOverlayProps): JSX.Element {
  const app = useRoomAppContext();
  const reactions = app.hooks.useReactions();
  const maxConcurrent = props.maxConcurrent ?? DEFAULT_MAX;
  const durationMs = props.durationMs ?? DEFAULT_DURATION_MS;
  const respectReducedMotion = props.respectReducedMotion ?? true;

  const [sprites, setSprites] = useState<readonly Sprite[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // When new reactions arrive, append them. We dedupe by the synthetic id
  // `${at}-${fromParticipantId}-${emoji}` because `useReactions().recent` is a
  // rolling buffer and may include events we've already rendered.
  useEffect(() => {
    if (!reactions || !Array.isArray(reactions.recent)) return;
    const seen = seenIdsRef.current;
    const fresh: Sprite[] = [];
    for (const r of reactions.recent) {
      const key = `${r.at}-${r.fromParticipantId}-${r.emoji}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        id: nextSpriteId(),
        emoji: r.emoji,
        leftPct: Math.random() * 80 + 10,
        startedAt: Date.now(),
      });
    }
    if (fresh.length === 0) return;
    setSprites((prev) => {
      const merged = [...prev, ...fresh];
      if (merged.length > maxConcurrent) {
        return merged.slice(merged.length - maxConcurrent);
      }
      return merged;
    });
  }, [reactions, maxConcurrent]);

  // Expire sprites after their duration. We use a single rAF-ish interval
  // rather than a timeout per sprite to keep the timer count bounded.
  useEffect(() => {
    if (sprites.length === 0) return undefined;
    const handle = window.setInterval(() => {
      const cutoff = Date.now() - durationMs;
      setSprites((prev) => prev.filter((s) => s.startedAt > cutoff));
    }, 250);
    return () => window.clearInterval(handle);
  }, [sprites.length, durationMs]);

  const reducedMotion =
    respectReducedMotion &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: 9998,
  };

  return (
    <div
      aria-hidden="true"
      className={props.className}
      style={{ ...overlayStyle, ...props.style }}
      data-sprite-count={sprites.length}
    >
      <style>{spriteKeyframes}</style>
      {sprites.map((sprite) => (
        <span
          key={sprite.id}
          style={{
            position: "absolute",
            bottom: 0,
            left: `${sprite.leftPct}%`,
            fontSize: "32px",
            lineHeight: 1,
            willChange: reducedMotion ? "opacity" : "transform, opacity",
            animation: reducedMotion
              ? `forging-rooms-reaction-fade ${durationMs}ms ease-out forwards`
              : `forging-rooms-reaction-float ${durationMs}ms cubic-bezier(0.16,1,0.3,1) forwards`,
          }}
        >
          {sprite.emoji}
        </span>
      ))}
    </div>
  );
}

const spriteKeyframes = `
@keyframes forging-rooms-reaction-float {
  0%   { transform: translateY(0) scale(0.6); opacity: 0; }
  10%  { transform: translateY(-20px) scale(1.0); opacity: 1; }
  100% { transform: translateY(-280px) scale(1.1); opacity: 0; }
}
@keyframes forging-rooms-reaction-fade {
  0%   { opacity: 0; }
  20%  { opacity: 1; }
  100% { opacity: 0; }
}
`;
