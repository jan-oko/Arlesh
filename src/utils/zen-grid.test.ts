import { describe, it, expect } from "vitest";
import {
  fitZenGrid, zenCardShowsBadges, zenDrawnOrder, zenNavigationTarget, zenTextSize,
  ZEN_GAP_PX, ZEN_MIN_CARD_HEIGHT_PX, ZEN_MIN_CARD_WIDTH_PX,
} from "./zen-grid";
import type { ZenNavigationModel } from "./zen-grid";

describe("fitZenGrid", () => {
  it("draws nothing for no cards", () => {
    expect(fitZenGrid(0, { width: 1200, height: 800 })).toEqual({ columns: 0, cardWidth: 0, cardHeight: 0, scrolls: false });
  });

  it("gives one card the whole area", () => {
    expect(fitZenGrid(1, { width: 1200, height: 800 })).toEqual({ columns: 1, cardWidth: 1200, cardHeight: 800, scrolls: false });
  });

  it("when 4 cards share a 1200×800 area, lays them out 2×2, each filling its cell", () => {
    // 1 column: 1200×(800−36)/4 = 191 tall → box 458 wide. 2 columns: 594×394 → box 594 wide.
    // 3 columns: 392×394 → 392. 4 columns: 291×800 → 291. Two columns win.
    expect(fitZenGrid(4, { width: 1200, height: 800 })).toEqual({ columns: 2, cardWidth: 594, cardHeight: 394, scrolls: false });
  });

  it("when 3 wide cards share a short wide strip, puts them side by side", () => {
    expect(fitZenGrid(3, { width: 1800, height: 300 }).columns).toBe(3);
  });

  it("when the cards get smaller as their number grows, keeps them at least the minimum", () => {
    const few = fitZenGrid(2, { width: 1200, height: 800 });
    const many = fitZenGrid(40, { width: 1200, height: 800 });
    expect(many.cardHeight).toBeLessThan(few.cardHeight);
    expect(many.scrolls).toBe(false);
    expect(many.cardHeight).toBeGreaterThanOrEqual(ZEN_MIN_CARD_HEIGHT_PX);
    expect(many.cardWidth).toBeGreaterThanOrEqual(ZEN_MIN_CARD_WIDTH_PX);
  });

  it("never lays a row out wider than the area", () => {
    for (const count of [1, 2, 3, 5, 7, 11, 17, 30]) {
      const layout = fitZenGrid(count, { width: 1013, height: 677 });
      expect(layout.columns * layout.cardWidth + (layout.columns - 1) * ZEN_GAP_PX).toBeLessThanOrEqual(1013);
    }
  });

  it("when no column count keeps every card at the minimum, scrolls at the minimum height instead", () => {
    // 200 cards in 1000×400: at 5 columns (190 wide) 40 rows need 40×48 + 39×12 px of height.
    const layout = fitZenGrid(200, { width: 1000, height: 400 });
    expect(layout.scrolls).toBe(true);
    expect(layout.cardHeight).toBe(ZEN_MIN_CARD_HEIGHT_PX);
    // As many 160px columns as fit in 1000px with 12px gaps: 5.
    expect(layout.columns).toBe(5);
    expect(layout.cardWidth).toBe(190);
  });

  it("when the scrolling grid has fewer cards than would fit across, uses one column per card", () => {
    const layout = fitZenGrid(3, { width: 1000, height: 40 });
    expect(layout).toMatchObject({ scrolls: true, columns: 3 });
  });

  it("before the area is measured, draws one column of minimum cards", () => {
    expect(fitZenGrid(5, null)).toEqual({
      columns: 1, cardWidth: ZEN_MIN_CARD_WIDTH_PX, cardHeight: ZEN_MIN_CARD_HEIGHT_PX, scrolls: true,
    });
  });
});

describe("zenTextSize", () => {
  it("draws a minimum card's title at the normal text size, on one line", () => {
    expect(zenTextSize(ZEN_MIN_CARD_WIDTH_PX, ZEN_MIN_CARD_HEIGHT_PX, false)).toEqual({ title: 14, path: 12, titleLines: 1 });
  });

  it("scales the title with a big card, up to its cap", () => {
    const medium = zenTextSize(600, 250, true);
    expect(medium.title).toBe(54);
    expect(medium.path).toBe(20);
    expect(zenTextSize(3000, 1200, true).title).toBe(64);
  });

  it("gives a tall card room for more title lines", () => {
    expect(zenTextSize(400, 400, true).titleLines).toBeGreaterThan(1);
  });
});

describe("zenCardShowsBadges", () => {
  it("draws the badge row only on a card tall enough, and only with the setting on", () => {
    expect(zenCardShowsBadges(72, true)).toBe(true);
    expect(zenCardShowsBadges(71, true)).toBe(false);
    expect(zenCardShowsBadges(300, false)).toBe(false);
  });
});

/** Seven cards in three columns: two full rows and a short last row centred under them. */
const RAGGED: ZenNavigationModel = {
  commitments: ["c1", "c2"],
  expectations: ["e1", "e2"],
  tasks: ["t0", "t1", "t2", "t3", "t4", "t5", "t6"],
  columns: 3,
};

describe("zenNavigationTarget", () => {
  it("steps left and right in reading order, onto the next row at a row's end", () => {
    expect(zenNavigationTarget(RAGGED, "t2", "right")).toBe("t3");
    expect(zenNavigationTarget(RAGGED, "t3", "left")).toBe("t2");
    expect(zenNavigationTarget(RAGGED, "t6", "right")).toBeNull();
    expect(zenNavigationTarget(RAGGED, "t0", "left")).toBeNull();
  });

  it("moves down a full row to the card beneath", () => {
    expect(zenNavigationTarget(RAGGED, "t1", "down")).toBe("t4");
  });

  it("lands on the nearest card of a centred short row, the earlier one on a tie", () => {
    // Four cards in three columns: the last row holds t3 alone, centred under t1.
    const model: ZenNavigationModel = { ...RAGGED, tasks: ["t0", "t1", "t2", "t3"] };
    expect(zenNavigationTarget(model, "t0", "down")).toBe("t3");
    expect(zenNavigationTarget(model, "t2", "down")).toBe("t3");
    expect(zenNavigationTarget(model, "t3", "up")).toBe("t1");
    // Five cards: the last row holds t3 and t4, centred half a column in — under t0/t1 and t1/t2.
    const five: ZenNavigationModel = { ...RAGGED, tasks: ["t0", "t1", "t2", "t3", "t4"] };
    expect(zenNavigationTarget(five, "t0", "down")).toBe("t3");
    expect(zenNavigationTarget(five, "t1", "down")).toBe("t3");
    expect(zenNavigationTarget(five, "t2", "down")).toBe("t4");
    expect(zenNavigationTarget(five, "t4", "up")).toBe("t1");
  });

  it("does nothing on the last row going down", () => {
    expect(zenNavigationTarget(RAGGED, "t6", "down")).toBeNull();
  });

  it("goes up from the top row into the Expectations strip, then the Commitments strip", () => {
    expect(zenNavigationTarget(RAGGED, "t2", "up")).toBe("e1");
    expect(zenNavigationTarget(RAGGED, "e2", "up")).toBe("c1");
    expect(zenNavigationTarget(RAGGED, "c1", "up")).toBeNull();
  });

  it("steps over a strip with nothing in it", () => {
    const model: ZenNavigationModel = { ...RAGGED, expectations: [] };
    expect(zenNavigationTarget(model, "t0", "up")).toBe("c1");
    expect(zenNavigationTarget(model, "c2", "down")).toBe("t0");
    expect(zenNavigationTarget({ ...model, commitments: [] }, "t0", "up")).toBeNull();
  });

  it("comes back down from a strip to the next strip, then to the grid's first card", () => {
    expect(zenNavigationTarget(RAGGED, "c2", "down")).toBe("e1");
    expect(zenNavigationTarget(RAGGED, "e2", "down")).toBe("t0");
  });

  it("moves along a strip and stops at its ends", () => {
    expect(zenNavigationTarget(RAGGED, "e1", "right")).toBe("e2");
    expect(zenNavigationTarget(RAGGED, "e2", "right")).toBeNull();
    expect(zenNavigationTarget(RAGGED, "c1", "left")).toBeNull();
  });

  it("with nothing selected, selects the grid's first card, or the first strip's with the grid empty", () => {
    expect(zenNavigationTarget(RAGGED, null, "up")).toBe("t0");
    expect(zenNavigationTarget({ ...RAGGED, tasks: [] }, null, "down")).toBe("c1");
    expect(zenNavigationTarget({ ...RAGGED, tasks: [] }, "gone", "down")).toBe("c1");
  });

  it("reads a single column as a plain list", () => {
    const column: ZenNavigationModel = { ...RAGGED, columns: 1 };
    expect(zenNavigationTarget(column, "t3", "down")).toBe("t4");
    expect(zenNavigationTarget(column, "t3", "up")).toBe("t2");
  });
});

describe("zenDrawnOrder", () => {
  it("lists the Commitments strip, the Expectations strip, then the grid", () => {
    expect(zenDrawnOrder(RAGGED)).toEqual(["c1", "c2", "e1", "e2", "t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
  });
});
