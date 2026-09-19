import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * How far one `j`/`k` press moves the viewport.
 *
 * 64px is the pitch of the shortest task row the list can draw: 16px of card padding top and
 * bottom, a single ~20px title line, and the 12px gap to the next card. So one press never carries
 * a whole row past you unseen — the row you were reading is always still partly on screen — while
 * still being a step you can see. Rows carrying a parent label or tag pills are taller, so there it
 * takes two or three presses to clear one, which is the right side to err on when reading ahead.
 *
 * A fixed amount rather than a measured row height (the user's call): the step stays the same
 * whatever row happens to be at the edge, so holding `j` moves at one steady speed instead of
 * stuttering as it passes rows of different heights.
 */
export const LIST_SCROLL_STEP_PX = 64;

/** The attribute the list's rows carry so the scroller can find the selected one. */
const ROW_ID_ATTRIBUTE = "data-row-id";

function findRow(container: Element, rowId: string): Element | null {
  for (const candidate of container.querySelectorAll(`[${ROW_ID_ATTRIBUTE}]`)) {
    if (candidate.getAttribute(ROW_ID_ATTRIBUTE) === rowId) return candidate;
  }
  return null;
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
 *   has scrolled out of sight.
 *
 * Where the two meet: scrolling away with `j` and then pressing `↓` re-anchors the view on the
 * selection, because the selection moved and the view follows it. That is deliberate — the arrow
 * keys mean "move the selection", and a selection you cannot see was the original complaint. The
 * corollary is equally deliberate: `↓` on the last row moves nothing, so it re-anchors nothing and
 * the view stays where `j` left it. The rule is "the view follows the selection", not "arrows
 * scroll".
 *
 * One scroller covers both of the List View's bands: the commitments section and the task rows
 * share the container that scrolls, so a selected Commitment is brought into view by exactly the
 * same code as a selected Task. Rows of either kind only need to carry `data-row-id`.
 */
export function useListScroll(selectedRowId: string | null): {
  /** Goes on the scrolling element — the one wrapping both the commitments band and the rows. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** One `j` (1) or `k` (-1) press. */
  scrollByStep: (direction: 1 | -1) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);

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

  const scrollByStep = useCallback((direction: 1 | -1) => {
    const container = containerRef.current;
    if (container === null || typeof container.scrollBy !== "function") return;
    // Instant, not smooth: holding the key repeats faster than a smooth scroll settles, and the
    // queued animations would lag visibly behind the keystrokes.
    container.scrollBy({ top: direction * LIST_SCROLL_STEP_PX, behavior: "auto" });
  }, []);

  return { containerRef, scrollByStep };
}
