/**
 * The geometry of one **Step**: how big a card is, how many fit, and where an arrow key lands.
 *
 * All of it is pure, and deliberately so — the view measures its own area with a `ResizeObserver`
 * and hands the numbers here. A Step **paginates** rather than scrolling, so "how many fit" is not
 * a cosmetic question: it decides what is on the page, and therefore what the arrows can reach.
 */

/** The zoom levels a Step can be drawn at, smallest card first. */
export const STEPS_ZOOM_LEVELS = [1, 2, 3, 4, 5] as const;

/** One of {@link STEPS_ZOOM_LEVELS} — the card size a tab is holding. */
export type StepsZoom = (typeof STEPS_ZOOM_LEVELS)[number];

/** The middle of the five: a card wide enough for a Task's fields without a Step going to pages. */
export const DEFAULT_STEPS_ZOOM: StepsZoom = 3;

/** Type guard for a stored zoom — a level this build does not have falls back to the default. */
export function isStepsZoom(value: unknown): value is StepsZoom {
  return STEPS_ZOOM_LEVELS.some((level) => level === value);
}

/** A card's drawn size at one zoom level, in pixels, gaps excluded. */
export interface CardSize {
  width: number;
  height: number;
}

/**
 * Card sizes by zoom level. Written out rather than scaled from a base, because a card is a read
 * mode of the editor and the smallest one has to stay legible — the fields do not shrink with it,
 * so the steps are the sizes at which a sensible number of them still fit.
 */
const CARD_SIZES: Readonly<Record<StepsZoom, CardSize>> = {
  1: { width: 168, height: 108 },
  2: { width: 208, height: 132 },
  3: { width: 256, height: 160 },
  4: { width: 312, height: 196 },
  5: { width: 380, height: 240 },
};

/** The gap between cards, at every zoom. */
export const CARD_GAP = 12;

/** What one card measures at `zoom`. */
export function cardSizeForZoom(zoom: StepsZoom): CardSize {
  return CARD_SIZES[zoom];
}

/** The shape of the child grid on one Step. */
export interface StepGrid {
  /** Cards across. At least one, so a viewport narrower than a card still draws (and clips) one. */
  columns: number;
  /** Rows down, on the same floor. */
  rows: number;
  /** How many children one page holds — `columns * rows`. */
  pageSize: number;
}

/** The area a grid of `count` cards needs, gaps included. */
function span(count: number, size: number): number {
  return count * size + (count - 1) * CARD_GAP;
}

/** How many cards of `size` fit across `available`, at least one. */
function fitCount(available: number, size: number): number {
  let count = 1;
  while (span(count + 1, size) <= available) count += 1;
  return count;
}

/**
 * The grid a Step's child area holds at `zoom`.
 *
 * **Page size is derived from the zoom and the viewport, not set independently.** The two would
 * otherwise contradict each other on every window resize — a page of twelve in an area that fits
 * eight either overflows or scrolls, and scrolling is the thing this view exists not to do. Zoom is
 * the control the user turns; the page follows it and the window.
 *
 * It answers only the measured question. An area that has **not** been laid out yet is not an area
 * that fits one card, and `useStepGrid` never asks about one — see {@link resolveGrid}.
 */
export function stepGrid(width: number, height: number, zoom: StepsZoom): StepGrid {
  const { width: cardWidth, height: cardHeight } = cardSizeForZoom(zoom);
  const columns = fitCount(Math.max(0, width), cardWidth);
  const rows = fitCount(Math.max(0, height), cardHeight);
  return { columns, rows, pageSize: columns * rows };
}

/**
 * The grid to draw with: the measured one, or — before the area has been laid out — **one page
 * holding everything**.
 *
 * The unmeasured case is the first paint, and it lasts one frame. A one-by-one grid there would
 * mean a single card and a pager reading "1 of 40" that both vanish immediately; showing the whole
 * level instead is wrong only about how it is arranged, which the next frame corrects. It is also
 * what a headless renderer sees for the whole of its life, and a view that only works once
 * something has measured it is a view that cannot be tested.
 */
export function resolveGrid(measured: StepGrid | null, childCount: number): StepGrid {
  if (measured !== null) return measured;
  const all = Math.max(1, childCount);
  return { columns: all, rows: 1, pageSize: all };
}

/** How many pages `childCount` children fill, at least one — an empty Step is still a Step. */
export function pageCount(childCount: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(childCount / pageSize));
}

/** `page` brought back inside the Step's real page range. */
export function clampPage(page: number, childCount: number, pageSize: number): number {
  const last = pageCount(childCount, pageSize) - 1;
  if (page < 0) return 0;
  return Math.min(page, last);
}

/** The children drawn on `page`. */
export function pageSlice<T>(children: readonly T[], page: number, pageSize: number): readonly T[] {
  if (pageSize <= 0) return [];
  const start = page * pageSize;
  return children.slice(start, start + pageSize);
}

/**
 * Where the selection sits on a Step.
 *
 * The **header card is a cell of the same grid**, not a separate thing with its own keys — one
 * navigation model, nothing extra to learn. `index` is within the current *page*, because a page is
 * what is on screen and an arrow key never leaves it: moving between pages is its own gesture,
 * deliberately distinct from descending and climbing so the three movements cannot be confused.
 */
export type StepCursor = { cell: "header" } | { cell: "child"; index: number };

/** The four directions an arrow key moves the cursor in. */
export type StepDirection = "up" | "down" | "left" | "right";

/** The header cell, which every Step has — even the empty ones. */
export const HEADER_CURSOR: StepCursor = { cell: "header" };

/** A cursor on the child at `index`. */
export function childCursor(index: number): StepCursor {
  return { cell: "child", index };
}

/**
 * Where `direction` takes `cursor`, given how many children the page holds and how wide it is.
 *
 * With nothing selected, `↓` takes the first child and `↑` takes the header — the same "start at
 * the near end" rule the List View's arrows follow. Every move that would leave the page stays put
 * instead of wrapping: wrapping would make `→` on the last card mean "next row", which reads as
 * having descended when it has not.
 */
export function moveCursor(
  cursor: StepCursor | null,
  direction: StepDirection,
  childCount: number,
  columns: number,
): StepCursor {
  if (cursor === null) {
    if (direction === "down" && childCount > 0) return childCursor(0);
    return HEADER_CURSOR;
  }
  if (cursor.cell === "header") {
    return direction === "down" && childCount > 0 ? childCursor(0) : HEADER_CURSOR;
  }
  const index = cursor.index;
  const width = Math.max(1, columns);
  switch (direction) {
    case "up":
      return index < width ? HEADER_CURSOR : childCursor(index - width);
    case "down": {
      const below = index + width;
      return below < childCount ? childCursor(below) : cursor;
    }
    case "left":
      return index % width === 0 ? cursor : childCursor(index - 1);
    case "right": {
      const next = index + 1;
      return next % width === 0 || next >= childCount ? cursor : childCursor(next);
    }
  }
}
