// Schema markers — `crdt()` and `counter()` annotations.
//
// These attach wire-semantics metadata to a Zod schema without changing its
// validation behavior. The factory at `createRoomApp` reads `__forgingMarker`
// to pick the right send path: LWW (default), CRDT merge (Phase 2), or atomic
// ADD (counter). The branded type ensures downstream hooks know which slots
// have special server semantics.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.2: "counter() and crdt() are markers that affect
//     schema interpretation; counter() triggers atomic-ADD semantics; crdt()
//     is stubbed for Phase 1".

import { z } from "zod";

/** Symbol carrying the marker kind on a Zod schema. Non-enumerable at runtime. */
export const FORGING_MARKER = Symbol.for("@forging/rooms/marker");

export type MarkerKind = "lww" | "crdt" | "counter";

export interface CounterOptions {
  readonly min?: number;
  readonly max?: number;
  readonly init?: number;
}

/** Branded shape attached to a Zod schema to record its marker. */
export interface MarkerAttachment<K extends MarkerKind> {
  readonly kind: K;
  readonly counter?: K extends "counter" ? CounterOptions : undefined;
}

/** A Zod schema decorated with a marker. The decoration is type-level only;
 *  at runtime the schema still validates identically — the marker just adds
 *  a non-enumerable property the factory reads. */
export type Marked<S extends z.ZodTypeAny, K extends MarkerKind> = S & {
  readonly [FORGING_MARKER]: MarkerAttachment<K>;
};

/** Read the marker off a (possibly marked) schema. Defaults to `lww`. */
export function readMarker(schema: z.ZodTypeAny): MarkerAttachment<MarkerKind> {
  // Defensive read; this code path executes at config time, not hot path.
  const attached = (schema as { readonly [FORGING_MARKER]?: unknown })[
    FORGING_MARKER
  ];
  if (
    attached &&
    typeof attached === "object" &&
    "kind" in (attached as Record<string, unknown>)
  ) {
    return attached as MarkerAttachment<MarkerKind>;
  }
  return { kind: "lww" };
}

function attachMarker<S extends z.ZodTypeAny, K extends MarkerKind>(
  schema: S,
  attachment: MarkerAttachment<K>,
): Marked<S, K> {
  // Use Object.defineProperty so the symbol property is non-enumerable.
  // We assign onto a NEW reference (don't mutate the original schema).
  // Zod schemas are class instances; we wrap them in a Proxy-free clone via
  // Object.create to preserve prototype chain without mutation.
  const clone = Object.create(
    Object.getPrototypeOf(schema) as object,
    Object.getOwnPropertyDescriptors(schema),
  ) as S;
  Object.defineProperty(clone, FORGING_MARKER, {
    value: Object.freeze(attachment),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return clone as Marked<S, K>;
}

/**
 * Mark a state slot as CRDT-managed. Phase 1: the marker exists and is
 * threaded through type inference, but the server treats CRDT slots as
 * standard LWW. Full CRDT semantics land in Phase 2.
 *
 * @example
 * ```ts
 * defineRoom({
 *   state: { drawing: crdt(z.array(z.string())) },
 *   // ...
 * });
 * ```
 */
export function crdt<S extends z.ZodTypeAny>(schema: S): Marked<S, "crdt"> {
  return attachMarker(schema, { kind: "crdt" });
}

/**
 * Mark a state slot as an atomic counter. The server applies `ADD` operations
 * instead of LWW replacement, so concurrent `+1` mutations from different
 * clients accumulate cleanly. The Zod schema must validate to `number`.
 *
 * @example
 * ```ts
 * defineRoom({
 *   state: { score: counter({ min: 0, init: 0 }) },
 *   // ...
 * });
 * ```
 */
export function counter(
  opts: CounterOptions = {},
): Marked<z.ZodNumber, "counter"> {
  // We accept CounterOptions and return a marked z.ZodNumber. The caller
  // doesn't pass a schema — the counter() helper synthesizes one because the
  // semantics fully determine the type (always a number).
  let schema: z.ZodNumber = z.number();
  if (opts.min !== undefined) schema = schema.min(opts.min);
  if (opts.max !== undefined) schema = schema.max(opts.max);
  return attachMarker(schema, {
    kind: "counter",
    counter: Object.freeze({ ...opts }),
  });
}
