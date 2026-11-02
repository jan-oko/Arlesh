import type { CSSProperties } from "react";

/** The bubble's natural width, and the room it leaves at the viewport's edges. */
const BUBBLE_WIDTH = 280;
const GUTTER = 8;
const GAP = 4;
/** Room needed under the mark before the bubble flips above it. */
const MIN_BELOW = 96;

/**
 * Where the bubble sits, in viewport coordinates: as wide as it can be up to its natural width and
 * never past the viewport minus a gutter either side, starting at the mark and shifted left as far
 * as it must to fit; under the mark, or above it where the room below is the smaller.
 */
export function bubblePlacement(
  mark: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
): CSSProperties {
  const width = Math.max(0, Math.min(BUBBLE_WIDTH, viewport.width - 2 * GUTTER));
  const left = Math.min(Math.max(mark.left, GUTTER), viewport.width - width - GUTTER);
  const below = viewport.height - mark.bottom - GAP - GUTTER;
  const above = mark.top - GAP - GUTTER;
  if (below >= MIN_BELOW || below >= above) {
    return { left, width, top: mark.bottom + GAP, maxHeight: Math.max(below, 0) };
  }
  return { left, width, bottom: viewport.height - mark.top + GAP, maxHeight: Math.max(above, 0) };
}
