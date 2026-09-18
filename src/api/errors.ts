/**
 * Every Tauri command rejects with this shape instead of a plain string
 * (see `.superpowers/sdd/2026-09-13-backend-architecture-foundations/`).
 * `details` is reserved for a later phase's confirmation prompts; nothing
 * populates it yet, so treat it as opaque.
 */

export type WireErrorKind =
  | "not_found"
  | "containment_violated"
  | "invalid_request"
  | "needs_confirmation"
  | "needs_time_scope"
  | "database"
  | "internal";

const WIRE_ERROR_KINDS: readonly string[] = [
  "not_found",
  "containment_violated",
  "invalid_request",
  "needs_confirmation",
  "needs_time_scope",
  "database",
  "internal",
] satisfies readonly WireErrorKind[];

function isWireErrorKind(value: string): value is WireErrorKind {
  return WIRE_ERROR_KINDS.includes(value);
}

export interface WireError {
  kind: WireErrorKind;
  message: string;
  details?: unknown;
}

/** Narrows an `unknown` rejection value to the structured wire error shape. */
export function isWireError(value: unknown): value is WireError {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("message" in value)) return false;
  const { kind, message } = value;
  return typeof kind === "string" && isWireErrorKind(kind) && typeof message === "string";
}

/**
 * Turns any rejected value (wire error, real Error, an object shaped like
 * one, or anything else) into a displayable string.
 *
 * Deliberately structural rather than routed through `isWireError`: if the
 * backend ever adds a `WireErrorKind` the frontend doesn't know about yet,
 * `isWireError` correctly returns `false` (kind-matching must stay strict),
 * but the value still carries a usable `message` and should display it
 * instead of falling through to `String(error)`.
 */
export function getErrorMessage(error: unknown): string {
  if (isWireError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}
