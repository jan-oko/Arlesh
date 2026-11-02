import { describe, it, expect } from "vitest";
import { NUDGE_MAX_PX, SLIDE_COMMIT_PX, slideOffset, slideOutcome } from "./swipe-slide";

describe("slideOffset", () => {
  it("follows the finger one for one when the swipe moves the card", () => {
    expect(slideOffset(37, true)).toBe(37);
    expect(slideOffset(-250, true)).toBe(-250);
  });

  it("only nudges a card whose swipe leaves it in place", () => {
    expect(slideOffset(30, false)).toBe(30);
    expect(slideOffset(400, false)).toBe(NUDGE_MAX_PX);
    expect(slideOffset(-400, false)).toBe(-NUDGE_MAX_PX);
  });
});

describe("slideOutcome", () => {
  it("springs back below the threshold and commits at and past it, either way", () => {
    expect(slideOutcome(SLIDE_COMMIT_PX - 1)).toBe("return");
    expect(slideOutcome(-(SLIDE_COMMIT_PX - 1))).toBe("return");
    expect(slideOutcome(SLIDE_COMMIT_PX)).toBe("commit");
    expect(slideOutcome(-SLIDE_COMMIT_PX - 40)).toBe("commit");
  });
});
