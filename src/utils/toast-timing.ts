/** Long enough to notice a toast you were not expecting and find its first word. */
const NOTICE_MS = 1200;
/** Roughly 170 words a minute — unhurried, for text arriving unannounced at the foot of a window. */
const READ_MS_PER_WORD = 350;
/** The floor, which is what a short message has always had. */
const MIN_DISMISS_MS = 3000;
/** The ceiling: past this a notice has outstayed its welcome whatever it says. */
const MAX_DISMISS_MS = 12000;

/** How long the toast takes to fade out — the stylesheet's `fadeout` animation. */
export const TOAST_FADE_MS = 400;

/**
 * How long a toast carrying `message` stays up.
 *
 * A fixed three seconds was fine while every toast was a handful of words. The paste-refusal
 * messages are not: one names a kind, the destination and every parent that kind may have, and a
 * paste that hits several refusals says all of them in the one toast the store can hold. Three
 * seconds of that is a message nobody finishes, which is the same as no message at all.
 */
export function dismissDelay(message: string): number {
  const words = message.trim().split(/\s+/).filter((word) => word.length > 0).length;
  return Math.min(MAX_DISMISS_MS, Math.max(MIN_DISMISS_MS, NOTICE_MS + words * READ_MS_PER_WORD));
}
