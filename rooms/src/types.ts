// Shared internal types. Most domain types live with their owning module
// (schema/, hooks/, components/, wire-format). This file collects only the
// cross-cutting helpers used by more than one of those modules.
//
// Public re-exports go through src/index.ts; internal modules import from the
// owning module directly to avoid circular references through this file.

/** Branded JSON value, used for places where we accept "anything JSON-shaped"
 *  but want to reject random objects with class identity (Dates, Maps, etc.). */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Mark a type as exhaustively handled in a switch. */
export function assertNever(x: never, context: string): never {
  throw new Error(
    `[@forging/rooms] unreachable: unexpected variant in ${context}: ${String(
      x,
    )}`,
  );
}
