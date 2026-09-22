import { describe, it, expect } from "vitest";
import {
  CARD_GAP, DEFAULT_STEPS_ZOOM, HEADER_CURSOR, cardSizeForZoom, childCursor, clampPage, isStepsZoom,
  moveCursor, pageCount, pageSlice, resolveGrid, stepGrid,
} from "./steps-grid";

describe("a stored zoom level", () => {
  it("is accepted when it is one of the five", () => {
    expect(isStepsZoom(DEFAULT_STEPS_ZOOM)).toBe(true);
    expect(isStepsZoom(1)).toBe(true);
    expect(isStepsZoom(5)).toBe(true);
  });

  it("is rejected when it is outside them, so a stale blob falls back rather than drawing nothing", () => {
    expect(isStepsZoom(0)).toBe(false);
    expect(isStepsZoom(6)).toBe(false);
    expect(isStepsZoom("3")).toBe(false);
    expect(isStepsZoom(undefined)).toBe(false);
  });
});

describe("the grid a Step's card area holds", () => {
  it("fits exactly the cards the width and height allow, gaps included", () => {
    const { width, height } = cardSizeForZoom(DEFAULT_STEPS_ZOOM);
    const area = { width: width * 3 + CARD_GAP * 2, height: height * 2 + CARD_GAP };
    expect(stepGrid(area.width, area.height, DEFAULT_STEPS_ZOOM)).toEqual({
      columns: 3, rows: 2, pageSize: 6,
    });
  });

  it("does not count a card the gap before it no longer leaves room for", () => {
    const { width, height } = cardSizeForZoom(DEFAULT_STEPS_ZOOM);
    // Two cards' worth of width, but nothing for the gap between them.
    expect(stepGrid(width * 2, height, DEFAULT_STEPS_ZOOM).columns).toBe(1);
  });

  it("gives a smaller zoom more columns in the same width", () => {
    const wide = 1200;
    const small = stepGrid(wide, 800, 1).columns;
    const large = stepGrid(wide, 800, 5).columns;
    expect(small).toBeGreaterThan(large);
  });

  it("never reports zero columns, so a viewport narrower than a card still draws one", () => {
    expect(stepGrid(10, 10, DEFAULT_STEPS_ZOOM)).toEqual({ columns: 1, rows: 1, pageSize: 1 });
  });
});

describe("the grid before the area has been laid out", () => {
  it("puts the whole level on one page rather than one card and a pager", () => {
    expect(resolveGrid(null, 40)).toEqual({ columns: 40, rows: 1, pageSize: 40 });
  });

  it("is one cell wide on an empty Step, so nothing divides by zero", () => {
    expect(resolveGrid(null, 0)).toEqual({ columns: 1, rows: 1, pageSize: 1 });
  });

  it("defers to the measurement the moment there is one", () => {
    const measured = { columns: 3, rows: 2, pageSize: 6 };
    expect(resolveGrid(measured, 40)).toBe(measured);
  });
});

describe("pages", () => {
  it("counts one page for an empty Step, because an empty Step is still a Step", () => {
    expect(pageCount(0, 6)).toBe(1);
  });

  it("counts a partial last page", () => {
    expect(pageCount(13, 6)).toBe(3);
  });

  it("clamps a page past the end back onto the last one", () => {
    expect(clampPage(9, 13, 6)).toBe(2);
    expect(clampPage(-1, 13, 6)).toBe(0);
  });

  it("slices the children the page draws", () => {
    const children = [0, 1, 2, 3, 4, 5, 6];
    expect(pageSlice(children, 0, 3)).toEqual([0, 1, 2]);
    expect(pageSlice(children, 2, 3)).toEqual([6]);
  });
});

describe("the arrow grid, with the header card as its first cell", () => {
  const COLUMNS = 3;
  const COUNT = 7;

  it("starts at the first child on ↓ and at the header on ↑ when nothing is selected", () => {
    expect(moveCursor(null, "down", COUNT, COLUMNS)).toEqual(childCursor(0));
    expect(moveCursor(null, "up", COUNT, COLUMNS)).toEqual(HEADER_CURSOR);
  });

  it("stays on the header when nothing is selected and there is nothing to descend to", () => {
    expect(moveCursor(null, "down", 0, COLUMNS)).toEqual(HEADER_CURSOR);
  });

  it("leaves the header only downwards", () => {
    expect(moveCursor(HEADER_CURSOR, "down", COUNT, COLUMNS)).toEqual(childCursor(0));
    expect(moveCursor(HEADER_CURSOR, "up", COUNT, COLUMNS)).toEqual(HEADER_CURSOR);
    expect(moveCursor(HEADER_CURSOR, "left", COUNT, COLUMNS)).toEqual(HEADER_CURSOR);
    expect(moveCursor(HEADER_CURSOR, "right", COUNT, COLUMNS)).toEqual(HEADER_CURSOR);
  });

  it("takes ↑ from the top row back to the header", () => {
    expect(moveCursor(childCursor(1), "up", COUNT, COLUMNS)).toEqual(HEADER_CURSOR);
  });

  it("moves a whole row on ↑ and ↓", () => {
    expect(moveCursor(childCursor(4), "up", COUNT, COLUMNS)).toEqual(childCursor(1));
    expect(moveCursor(childCursor(1), "down", COUNT, COLUMNS)).toEqual(childCursor(4));
  });

  it("stays put rather than wrapping at every edge", () => {
    expect(moveCursor(childCursor(0), "left", COUNT, COLUMNS)).toEqual(childCursor(0));
    expect(moveCursor(childCursor(2), "right", COUNT, COLUMNS)).toEqual(childCursor(2));
    expect(moveCursor(childCursor(6), "down", COUNT, COLUMNS)).toEqual(childCursor(6));
    expect(moveCursor(childCursor(6), "right", COUNT, COLUMNS)).toEqual(childCursor(6));
  });

  it("walks along a row on ← and →", () => {
    expect(moveCursor(childCursor(3), "right", COUNT, COLUMNS)).toEqual(childCursor(4));
    expect(moveCursor(childCursor(4), "left", COUNT, COLUMNS)).toEqual(childCursor(3));
  });
});
