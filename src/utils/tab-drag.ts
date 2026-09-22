/**
 * What a drag that started on a tab meant, once it has ended.
 *
 * Inside the strip a drag is a reorder, and the strip's own drop handler has already dealt with it.
 * Outside the strip it is the browser gesture everybody already knows: the tab comes out as a
 * window of its own.
 */

/** Where the pointer was, in the window's own coordinates. */
export interface DragPoint {
  x: number;
  y: number;
}

/** The strip's rectangle, as `getBoundingClientRect` reports one. */
export interface DragBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Whether a drag that ended at `point` tore the tab out of the strip.
 *
 * Two conditions, and they answer different failure modes. A drop that **landed on the strip** is a
 * reorder that has already happened, so the drag is over and there is nothing to tear off. A
 * pointer still **inside the strip's rectangle** is a drag that went nowhere — dropped on the gap
 * beside the tabs, or on the + — and doing nothing is the right answer for it.
 *
 * The second condition is also what makes the failure safe. A platform that reports no coordinates
 * at all for the end of a drag hands us `(0, 0)`, which is inside the strip — the strip is at the
 * top of the window — so the gesture is read as "went nowhere" and no window appears. A tear-off
 * that does not happen costs one more attempt; a window that appears from a drag the user did not
 * make is a window they have to go and close.
 */
export function isTornOff(point: DragPoint, strip: DragBounds, droppedOnStrip: boolean): boolean {
  if (droppedOnStrip) return false;
  const inside =
    point.x >= strip.left && point.x <= strip.right && point.y >= strip.top && point.y <= strip.bottom;
  return !inside;
}
