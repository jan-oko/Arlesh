import { describe, expect, it } from "vitest";
import { isTornOff } from "./tab-drag";

/** A strip across the top of an 800-pixel-wide window. */
const STRIP = { left: 0, top: 0, right: 800, bottom: 32 };

describe("a drag that started on a tab", () => {
  it("tears the tab off when it ends over the board below the strip", () => {
    expect(isTornOff({ x: 400, y: 300 }, STRIP, false)).toBe(true);
  });

  it("tears the tab off when it ends past the side of the window", () => {
    expect(isTornOff({ x: 1200, y: 16 }, STRIP, false)).toBe(true);
  });

  it("does not tear the tab off when the strip took the drop, which is a reorder", () => {
    expect(isTornOff({ x: 400, y: 300 }, STRIP, true)).toBe(false);
  });

  it("does nothing when the drag ends on the empty part of the strip", () => {
    expect(isTornOff({ x: 700, y: 16 }, STRIP, false)).toBe(false);
  });

  it("does nothing when the platform reports no coordinates at all", () => {
    // A drag end with no position comes through as (0, 0), which is inside the strip. Reading that
    // as "went nowhere" is the safe way round: a window that never appeared costs one more try.
    expect(isTornOff({ x: 0, y: 0 }, STRIP, false)).toBe(false);
  });

  it("counts the strip's own edge as inside it", () => {
    expect(isTornOff({ x: 800, y: 32 }, STRIP, false)).toBe(false);
    expect(isTornOff({ x: 801, y: 33 }, STRIP, false)).toBe(true);
  });
});
