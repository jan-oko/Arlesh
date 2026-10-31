/**
 * The touch gestures' geometry (`docs/spec/touch.md`), as pure functions over where and when a
 * finger went down and came up. Nothing here reads an event or a clock: the hook that listens
 * hands the samples in, which is what lets the thresholds be tested as numbers.
 */

/** One touch sample: a screen position and the time it was taken, in milliseconds. */
export interface TouchSample {
  x: number;
  y: number;
  t: number;
}

/** How far a finger may wander and still have tapped, or still be holding still. */
export const TAP_SLOP_PX = 10;
/** How long a finger must hold still for a long-press. */
export const LONG_PRESS_MS = 500;
/** The window for the second tap of a double-tap. */
export const DOUBLE_TAP_MS = 300;
/** A flick up is quick: any slower and the move was a scroll. */
export const FLICK_MAX_MS = 250;
/** A flick up covers at least this much… */
export const FLICK_MIN_PX = 30;
/** …and no more than this: a longer move was a scroll, however fast. */
export const FLICK_MAX_PX = 160;
/** A row swipe covers at least this much sideways. */
export const SWIPE_MIN_PX = 60;
/** And takes no longer than this; a slow sideways drag is not a swipe. */
export const SWIPE_MAX_MS = 800;
/** A move is along an axis when it is at least this many times longer along it than across. */
const AXIS_RATIO = 2;

/** What a single finger's touch, released without a long-press, amounts to. */
export type SingleFingerGesture =
  | { kind: "tap" }
  | { kind: "flickUp" }
  | { kind: "swipe"; direction: "left" | "right" }
  | { kind: "none" };

/** Whether a finger is still within the tap slop of where it went down. */
export function isStill(start: TouchSample, now: TouchSample): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) <= TAP_SLOP_PX;
}

/**
 * Classifies a released single touch. A tap stays still; a flick up is quick, short and upward;
 * a swipe is long enough sideways. Anything else — a slow or long vertical move — was a scroll,
 * which the browser has already handled.
 */
export function classifyRelease(start: TouchSample, end: TouchSample): SingleFingerGesture {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const duration = end.t - start.t;
  if (isStill(start, end)) return { kind: "tap" };
  const vertical = Math.abs(dy) >= AXIS_RATIO * Math.abs(dx);
  const horizontal = Math.abs(dx) >= AXIS_RATIO * Math.abs(dy);
  if (vertical && dy < 0 && duration <= FLICK_MAX_MS && -dy >= FLICK_MIN_PX && -dy <= FLICK_MAX_PX) {
    return { kind: "flickUp" };
  }
  if (horizontal && Math.abs(dx) >= SWIPE_MIN_PX && duration <= SWIPE_MAX_MS) {
    return { kind: "swipe", direction: dx > 0 ? "right" : "left" };
  }
  return { kind: "none" };
}

/** Whether a second tap at `now` completes a double-tap begun by a tap at `previous`. */
export function isSecondTap(previous: TouchSample | null, now: TouchSample): boolean {
  if (previous === null) return false;
  return now.t - previous.t <= DOUBLE_TAP_MS && Math.hypot(now.x - previous.x, now.y - previous.y) <= 3 * TAP_SLOP_PX;
}

/** Two fingers' samples, in the order they touched. */
export type TwoFingers = readonly [TouchSample, TouchSample];

/** A two-finger swipe covers at least this much sideways. */
export const TWO_FINGER_SWIPE_MIN_PX = 80;
/** And keeps the fingers this close to their starting spread — more, and it was a pinch. */
const TWO_FINGER_SPREAD_TOLERANCE_PX = 40;

function spread([a, b]: TwoFingers): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint([a, b]: TwoFingers): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * A two-finger swipe left or right — the preset cycle — or `null`. The fingers move together, so
 * their spread barely changes; a pinch changes it, and is not a swipe.
 */
export function classifyTwoFingerSwipe(start: TwoFingers, end: TwoFingers): "left" | "right" | null {
  if (Math.abs(spread(end) - spread(start)) > TWO_FINGER_SPREAD_TOLERANCE_PX) return null;
  const from = midpoint(start);
  const to = midpoint(end);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < TWO_FINGER_SWIPE_MIN_PX || Math.abs(dx) < AXIS_RATIO * Math.abs(dy)) return null;
  return dx > 0 ? "right" : "left";
}

/** The factor two fingers have spread by since they touched: above 1 they moved apart. */
export function pinchScale(start: TwoFingers, now: TwoFingers): number {
  const from = spread(start);
  return from === 0 ? 1 : spread(now) / from;
}

/** One zoom step per this factor of pinch, for the views whose zoom moves in steps. */
export const PINCH_STEP = 1.25;
