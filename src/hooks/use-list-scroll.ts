import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { SCROLL_DOWN_CODE, SCROLL_UP_CODE } from "@/utils/hotkeys/list-bindings";

/**
 * How far a single `j`/`k` press nudges the viewport.
 *
 * 24px is about one line of the list's text and its leading — `--text-base` is 14px, a title line
 * boxes out around 20px, plus the 4px gap to what follows. A line is the unit a reader tracks, so
 * the eye follows a nudge of one without having to re-find its place, which is what "smooth" means
 * at this scale. Three or four taps clear a compact row rather than one clearing it outright.
 *
 * A fixed amount rather than a measured row height (the user's call): the step stays the same
 * whatever row happens to be at the edge, so tapping moves by one predictable unit instead of
 * lurching by whatever is under the fold.
 */
export const LIST_SCROLL_STEP_PX = 24;

/**
 * How fast the viewport moves while `j`/`k` is held, in pixels per second.
 *
 * The speed is set here rather than left to key auto-repeat, which is the point of running the
 * hold from an animation frame: the OS repeat rate varies per machine and per user setting, and at
 * a typical ~25 repeats a second a held key used to cover something like 1600px/s — the "too fast"
 * the feedback is about. 300px/s is roughly four to five compact rows a second: quick enough to
 * cross a long list in a couple of seconds, slow enough that titles stay readable on the way past.
 */
export const LIST_SCROLL_HOLD_SPEED_PX_PER_SECOND = 300;

/**
 * How long the key must be held before the continuous scroll takes over from the single nudge.
 *
 * The same idea as a keyboard's own repeat delay, and for the same reason: a tap must stay a tap.
 * Below this, a press is exactly one `LIST_SCROLL_STEP_PX` nudge and nothing else.
 */
export const LIST_SCROLL_HOLD_DELAY_MS = 250;

/** The attribute the list's rows carry so the scroller can find the selected one. */
const ROW_ID_ATTRIBUTE = "data-row-id";

function findRow(container: Element, rowId: string): Element | null {
  for (const candidate of container.querySelectorAll(`[${ROW_ID_ATTRIBUTE}]`)) {
    if (candidate.getAttribute(ROW_ID_ATTRIBUTE) === rowId) return candidate;
  }
  return null;
}

/** A key being held down, and how far its continuous scroll has moved the viewport so far. */
interface Hold {
  direction: 1 | -1;
  /** The first frame's timestamp — the hold is timed from there, not from the keydown. */
  startedAt: number | null;
  /** Total pixels already asked for, so rounding each frame cannot accumulate drift. */
  emitted: number;
  frame: number;
}

/** What the hold machinery below needs to reach: the element that scrolls, and the running hold. */
interface Viewport {
  container: RefObject<HTMLDivElement | null>;
  hold: RefObject<Hold | null>;
}

function scrollViewport(viewport: Viewport, pixels: number): void {
  const container = viewport.container.current;
  if (container === null || typeof container.scrollBy !== "function") return;
  // Instant: the smoothness comes from the size of each move and the frame rate, not from asking
  // the browser to animate one — an animated scroll per frame would fight the next frame's.
  container.scrollBy({ top: pixels, behavior: "auto" });
}

function endHold(viewport: Viewport): void {
  const hold = viewport.hold.current;
  if (hold === null) return;
  viewport.hold.current = null;
  cancelAnimationFrame(hold.frame);
}

/**
 * One frame of a held key. The frame timestamp is the only clock: it is what the browser hands the
 * callback, and it keeps the motion tied to the frames actually drawn rather than to wall-clock
 * time. Module scope rather than a `useCallback`, so the loop can name itself to book the next frame.
 */
function stepHold(viewport: Viewport, timestamp: number): void {
  const hold = viewport.hold.current;
  if (hold === null) return;
  if (hold.startedAt === null) hold.startedAt = timestamp;

  const heldMs = timestamp - hold.startedAt - LIST_SCROLL_HOLD_DELAY_MS;
  if (heldMs > 0) {
    // Measured from the total distance owed rather than per-frame deltas, so rounding to whole
    // pixels each frame cannot drift the speed over a long hold.
    const owed = Math.round((LIST_SCROLL_HOLD_SPEED_PX_PER_SECOND * heldMs) / 1000);
    const delta = owed - hold.emitted;
    if (delta > 0) {
      hold.emitted = owed;
      scrollViewport(viewport, hold.direction * delta);
    }
  }
  hold.frame = requestAnimationFrame((next) => stepHold(viewport, next));
}

function beginHold(viewport: Viewport, direction: 1 | -1): void {
  // A fresh press replaces whatever was running, so reversing direction mid-hold does not leave
  // two loops fighting over the viewport.
  endHold(viewport);
  scrollViewport(viewport, direction * LIST_SCROLL_STEP_PX);
  viewport.hold.current = {
    direction,
    startedAt: null,
    emitted: 0,
    frame: requestAnimationFrame((timestamp) => stepHold(viewport, timestamp)),
  };
}

/**
 * The List View's viewport: it follows the selection, and `j`/`k` roam it freely.
 *
 * Two behaviours that have to agree on who owns the scroll position:
 *
 * - **The view follows the selection.** Whenever the selected row *changes*, that row is scrolled
 *   into view with `nearest` alignment, so a row already on screen does not jump and a row past the
 *   fold comes just far enough in to be read.
 * - **`j`/`k` move the viewport and nothing else.** The selection stays where it is, even once it
 *   has scrolled out of sight. A tap nudges by one line; holding the key scrolls continuously.
 *
 * Where the two meet: scrolling away with `j` and then pressing `↓` re-anchors the view on the
 * selection, because the selection moved and the view follows it. That is deliberate — the arrow
 * keys mean "move the selection", and a selection you cannot see was the original complaint. The
 * corollary is equally deliberate: `↓` on the last row moves nothing, so it re-anchors nothing and
 * the view stays where `j` left it. The rule is "the view follows the selection", not "arrows
 * scroll".
 *
 * **Why the hold runs on animation frames rather than on key auto-repeat.** Scrolling a fixed step
 * per repeat hands the speed to the OS: the repeat rate is a per-machine setting this code cannot
 * see, and at a typical rate it came out far too fast. Smooth-scrolling each step instead would be
 * worse — repeats arrive faster than a smooth scroll settles, so the animations queue and lag
 * visibly behind the keys. A frame loop at a fixed pixels-per-second is the one option where the
 * pace is ours and every frame lands where it should. Per-frame motion also means the movement is
 * genuinely continuous rather than a series of jumps.
 *
 * The loop must therefore be stopped by something other than a repeat drying up: the key's release,
 * the window losing focus (alt-tab while holding), or this view unmounting. All three are handled;
 * a hold can never outlive its key.
 *
 * One scroller covers both of the List View's bands: the commitments section and the task rows
 * share the container that scrolls, so a selected Commitment is brought into view by exactly the
 * same code as a selected Task. Rows of either kind only need to carry `data-row-id`.
 */
export function useListScroll(selectedRowId: string | null): {
  /** Goes on the scrolling element — the one wrapping both the commitments band and the rows. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** One `j` (1) or `k` (-1) press: a nudge, then a continuous scroll while the key stays down. */
  startScroll: (direction: 1 | -1) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<Hold | null>(null);
  const viewport = useMemo(() => ({ container: containerRef, hold: holdRef }), []);

  // Keyed on the selected id alone, so only a selection *move* pulls the viewport back; any other
  // re-render (a status cycle, a filter chip, a reload) leaves the scroll position alone.
  useEffect(() => {
    if (selectedRowId === null) return;
    const container = containerRef.current;
    if (container === null) return;
    const row = findRow(container, selectedRowId);
    // jsdom implements no scrolling at all, so the method can be missing; nothing to do then.
    if (row === null || typeof row.scrollIntoView !== "function") return;
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedRowId]);

  const startScroll = useCallback((direction: 1 | -1) => beginHold(viewport, direction), [viewport]);

  useEffect(() => {
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== SCROLL_DOWN_CODE && event.code !== SCROLL_UP_CODE) return;
      endHold(viewport);
    }
    function stop() {
      endHold(viewport);
    }
    // Capture, so a modal opening under the held key cannot swallow the release and strand the loop.
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    // Alt-tabbing away while holding: the keyup lands in the other window, never here.
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", stop);
      // A hold can never outlive the view it scrolls.
      endHold(viewport);
    };
  }, [viewport]);

  return { containerRef, startScroll };
}
