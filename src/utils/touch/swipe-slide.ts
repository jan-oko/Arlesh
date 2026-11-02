import { SWIPE_MIN_PX } from "@/utils/touch/gestures";

/**
 * The swipe's drag feedback (`docs/spec/touch.md`), as pure functions over how far the finger has
 * moved sideways: where the card is drawn while the finger drags, and whether letting go commits.
 * The hook that listens (`use-touch-gestures`) applies the numbers; nothing here reads an event.
 */

/** How far a card that is not leaving slides with the finger, at most — a nudge, not a drag. */
export const NUDGE_MAX_PX = 96;
/** The distance past which letting go commits the swipe: the same as the swipe's own minimum. */
export const SLIDE_COMMIT_PX = SWIPE_MIN_PX;
/** How long a committed card takes to leave. */
export const FLY_OUT_MS = 180;
/** How long a card whose action left it in place waits before it springs back. */
export const RETURN_AFTER_MS = 600;

/**
 * Where the card is drawn, in px from home, with the finger `dx` px from where it went down. A card
 * whose swipe moves it (`leaves`) follows the finger one for one; any other only nudges.
 */
export function slideOffset(dx: number, leaves: boolean): number {
  if (leaves) return dx;
  return Math.max(-NUDGE_MAX_PX, Math.min(NUDGE_MAX_PX, dx));
}

/** Whether letting go `dx` px from home commits the swipe (flies the card out) or springs it back. */
export function slideOutcome(dx: number): "commit" | "return" {
  return Math.abs(dx) >= SLIDE_COMMIT_PX ? "commit" : "return";
}
