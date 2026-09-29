/**
 * The Zen View's grid: how many columns its cards take, how big they are drawn, how big their text
 * is, and where the arrow keys go from one card to the next. Pure, so the fit and the landing rule
 * are tested without a layout engine.
 */

/** The shape each column count is judged by: the largest box of this width-to-height ratio. */
export const ZEN_CARD_ASPECT = 2.4;
/** The space between cards, both ways. */
export const ZEN_GAP_PX = 12;
/**
 * The smallest card: one title line at the normal text size (14px), a path line at the small size
 * (12px) and the card's padding. Below this the grid scrolls rather than shrinking the cards.
 */
export const ZEN_MIN_CARD_HEIGHT_PX = 48;
/** The narrowest card — about the width a short title needs to stay readable. */
export const ZEN_MIN_CARD_WIDTH_PX = 160;
/** A card shorter than this has no room for the badge row under its title and path. */
export const ZEN_BADGE_MIN_CARD_HEIGHT_PX = 72;

/** The normal text size: the smallest a card title is drawn. */
const TITLE_MIN_PX = 14;
const TITLE_MAX_PX = 64;
const TITLE_PER_HEIGHT = 0.28;
const TITLE_PER_WIDTH = 0.09;
const PATH_PER_TITLE = 0.45;
const PATH_MIN_PX = 12;
const PATH_MAX_PX = 20;

/** How the grid is drawn in an area of a given size. */
export interface ZenGridLayout {
  columns: number;
  cardWidth: number;
  cardHeight: number;
  /** Whether the cards are at their minimum size and the grid scrolls vertically to hold them. */
  scrolls: boolean;
}

/** The area the grid has to fill. */
export interface ZenArea {
  width: number;
  height: number;
}

const EMPTY_LAYOUT: ZenGridLayout = { columns: 0, cardWidth: 0, cardHeight: 0, scrolls: false };

/** One column count's cell. */
interface Candidate {
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

function candidateFor(count: number, columns: number, area: ZenArea): Candidate {
  const rows = Math.ceil(count / columns);
  return {
    columns,
    cellWidth: (area.width - (columns - 1) * ZEN_GAP_PX) / columns,
    cellHeight: (area.height - (rows - 1) * ZEN_GAP_PX) / rows,
  };
}

function holdsMinimumCard(candidate: Candidate): boolean {
  return candidate.cellWidth >= ZEN_MIN_CARD_WIDTH_PX && candidate.cellHeight >= ZEN_MIN_CARD_HEIGHT_PX;
}

/** The width of the largest {@link ZEN_CARD_ASPECT} box the cell holds — what a count is judged by. */
function score(candidate: Candidate): number {
  return Math.min(candidate.cellWidth, candidate.cellHeight * ZEN_CARD_ASPECT);
}

/**
 * The grid at the minimum card height: as many columns as fit at the minimum width (at least one,
 * never more than there are cards), the cards stretched to fill the width.
 */
function scrollingLayout(count: number, width: number): ZenGridLayout {
  const fitting = Math.floor((width + ZEN_GAP_PX) / (ZEN_MIN_CARD_WIDTH_PX + ZEN_GAP_PX));
  const columns = Math.max(1, Math.min(count, fitting));
  const cellWidth = (width - (columns - 1) * ZEN_GAP_PX) / columns;
  return {
    columns,
    cardWidth: Math.max(ZEN_MIN_CARD_WIDTH_PX, Math.floor(cellWidth)),
    cardHeight: ZEN_MIN_CARD_HEIGHT_PX,
    scrolls: true,
  };
}

/**
 * The grid `count` cards take in `area`, or the scrolling grid at the minimum card size when no
 * column count can keep every card at least that big. `area` is `null` before it has been laid out,
 * which draws the scrolling grid at the minimum width.
 *
 * Every column count is tried; the one chosen gives the largest 2.4 : 1 box inside a cell, and ties
 * go to fewer columns. The cards then fill their cells — the ratio chooses the grid's shape, it does
 * not hold the cards to it. Sizes are floored so a row of cards never adds up to more than the width
 * and wraps.
 */
export function fitZenGrid(count: number, area: ZenArea | null): ZenGridLayout {
  if (count <= 0) return EMPTY_LAYOUT;
  if (area === null) return scrollingLayout(count, ZEN_MIN_CARD_WIDTH_PX);
  let best: Candidate | null = null;
  for (let columns = 1; columns <= count; columns++) {
    const candidate = candidateFor(count, columns, area);
    if (!holdsMinimumCard(candidate)) continue;
    if (best === null || score(candidate) > score(best)) best = candidate;
  }
  if (best === null) return scrollingLayout(count, area.width);
  return {
    columns: best.columns,
    cardWidth: Math.floor(best.cellWidth),
    cardHeight: Math.floor(best.cellHeight),
    scrolls: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A card's text sizes, in px. */
export interface ZenTextSize {
  title: number;
  path: number;
  /** How many lines of title the card has room for beside its path line (and badges). */
  titleLines: number;
}

/** Vertical padding inside a card, top and bottom together — mirrors `ZenTaskCard.module.css`. */
const CARD_PADDING_Y_PX = 12;
const LINE_HEIGHT = 1.2;
/** The badge row's own height, where it is drawn. */
const BADGE_ROW_PX = 16;

/**
 * How big a card's title and path are drawn: the title scales with the card, from the normal text
 * size on a minimum card up to 64px, and the path follows at a little under half of it.
 */
export function zenTextSize(cardWidth: number, cardHeight: number, withBadges: boolean): ZenTextSize {
  const title = Math.round(clamp(Math.min(cardHeight * TITLE_PER_HEIGHT, cardWidth * TITLE_PER_WIDTH), TITLE_MIN_PX, TITLE_MAX_PX));
  const path = Math.round(clamp(title * PATH_PER_TITLE, PATH_MIN_PX, PATH_MAX_PX));
  const room = cardHeight - CARD_PADDING_Y_PX - path * LINE_HEIGHT - (withBadges ? BADGE_ROW_PX : 0);
  return { title, path, titleLines: Math.max(1, Math.floor(room / (title * LINE_HEIGHT))) };
}

/** Whether a card of this height draws its badge row, given the setting. */
export function zenCardShowsBadges(cardHeight: number, setting: boolean): boolean {
  return setting && cardHeight >= ZEN_BADGE_MIN_CARD_HEIGHT_PX;
}

/** Which way an arrow key moves the selection. */
export type ZenDirection = "up" | "down" | "left" | "right";

/**
 * What the arrows move over: the two strips, top to bottom, and the grid's cards in reading order.
 * A hidden or empty strip is an empty list and is stepped over.
 */
export interface ZenNavigationModel {
  commitments: readonly string[];
  expectations: readonly string[];
  tasks: readonly string[];
  columns: number;
}

/** Where a card sits in the grid, as drawn: its row, and its centre in column units. */
interface GridPlace {
  row: number;
  centre: number;
}

function rowCount(total: number, columns: number): number {
  return Math.ceil(total / columns);
}

/** How many cards row `row` holds — every row is full but the last. */
function cardsInRow(total: number, columns: number, row: number): number {
  return Math.min(columns, total - row * columns);
}

/** A short row is centred, so its cards sit half a column in for every card it is short. */
function rowOffset(total: number, columns: number, row: number): number {
  return (columns - cardsInRow(total, columns, row)) / 2;
}

function placeOf(index: number, total: number, columns: number): GridPlace {
  const row = Math.floor(index / columns);
  return { row, centre: (index % columns) + rowOffset(total, columns, row) };
}

/** The card in `row` whose centre is nearest `centre`; on a tie, the earlier one. */
function nearestInRow(total: number, columns: number, row: number, centre: number): number {
  const offset = rowOffset(total, columns, row);
  const count = cardsInRow(total, columns, row);
  let best = 0;
  for (let slot = 1; slot < count; slot++) {
    if (Math.abs(slot + offset - centre) < Math.abs(best + offset - centre)) best = slot;
  }
  return row * columns + best;
}

/** The strips as drawn, top to bottom, leaving out the empty ones. */
function strips(model: ZenNavigationModel): (readonly string[])[] {
  return [model.commitments, model.expectations].filter((strip) => strip.length > 0);
}

function firstCard(model: ZenNavigationModel): string | null {
  return model.tasks[0] ?? strips(model)[0]?.[0] ?? null;
}

function moveInGrid(model: ZenNavigationModel, index: number, direction: ZenDirection): string | null {
  const { tasks } = model;
  const columns = Math.max(1, model.columns);
  if (direction === "left") return tasks[index - 1] ?? null;
  if (direction === "right") return tasks[index + 1] ?? null;
  const place = placeOf(index, tasks.length, columns);
  const targetRow = place.row + (direction === "down" ? 1 : -1);
  if (targetRow >= rowCount(tasks.length, columns)) return null;
  if (targetRow < 0) {
    const shown = strips(model);
    return shown[shown.length - 1]?.[0] ?? null;
  }
  return tasks[nearestInRow(tasks.length, columns, targetRow, place.centre)] ?? null;
}

function moveInStrip(model: ZenNavigationModel, stripIndex: number, index: number, direction: ZenDirection): string | null {
  const shown = strips(model);
  const strip = shown[stripIndex] ?? [];
  if (direction === "left") return strip[index - 1] ?? null;
  if (direction === "right") return strip[index + 1] ?? null;
  if (direction === "up") return shown[stripIndex - 1]?.[0] ?? null;
  return shown[stripIndex + 1]?.[0] ?? model.tasks[0] ?? null;
}

/**
 * Where an arrow key takes the selection from `selectedId`, or `null` to leave it where it is.
 *
 * In the grid, ← and → step through reading order, onto the next row at a row's end; ↑ and ↓ move a
 * row, landing on the card whose drawn centre is nearest — which is what keeps a centred short last
 * row honest. ↑ off the top row enters the lowest strip showing, at its first card; ↓ off a strip
 * goes to the strip below it or back to the grid's first card. With nothing selected (or a selection
 * no longer drawn) any arrow selects the grid's first card, or the first strip's with the grid empty.
 */
export function zenNavigationTarget(
  model: ZenNavigationModel,
  selectedId: string | null,
  direction: ZenDirection,
): string | null {
  if (selectedId === null) return firstCard(model);
  const taskIndex = model.tasks.indexOf(selectedId);
  if (taskIndex >= 0) return moveInGrid(model, taskIndex, direction);
  const shown = strips(model);
  const stripIndex = shown.findIndex((strip) => strip.includes(selectedId));
  if (stripIndex < 0) return firstCard(model);
  return moveInStrip(model, stripIndex, (shown[stripIndex] ?? []).indexOf(selectedId), direction);
}

/** Every card in drawn order — the Commitments strip, the Expectations strip, then the grid. */
export function zenDrawnOrder(model: ZenNavigationModel): string[] {
  return [...model.commitments, ...model.expectations, ...model.tasks];
}
