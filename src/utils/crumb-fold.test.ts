import { describe, it, expect } from "vitest";
import { crumbFold, lastFoldStep } from "@/utils/crumb-fold";

describe("crumbFold", () => {
  it("shows the whole chain before any step is taken", () => {
    expect(crumbFold(0, 3)).toEqual({
      rootShown: true,
      middlesFolded: 0,
      currentShown: true,
      currentTruncates: false,
    });
  });

  it("folds the middle one level at a time, nearest the root first, keeping root and current", () => {
    expect(crumbFold(2, 3)).toEqual({
      rootShown: true,
      middlesFolded: 2,
      currentShown: true,
      currentTruncates: false,
    });
    expect(crumbFold(3, 3)).toEqual({
      rootShown: true,
      middlesFolded: 3,
      currentShown: true,
      currentTruncates: false,
    });
  });

  it("drops the root next, leaving `… › current`", () => {
    expect(crumbFold(4, 3)).toEqual({
      rootShown: false,
      middlesFolded: 3,
      currentShown: true,
      currentTruncates: false,
    });
  });

  it("then tries `root › …`, for a current title too long to stand alone", () => {
    expect(crumbFold(5, 3)).toEqual({
      rootShown: true,
      middlesFolded: 3,
      currentShown: false,
      currentTruncates: false,
    });
  });

  it("truncates only as the last resort, and only the current title, after `…`", () => {
    expect(crumbFold(6, 3)).toEqual({
      rootShown: false,
      middlesFolded: 3,
      currentShown: true,
      currentTruncates: true,
    });
  });

  it("runs the same order for a chain with no middle to fold", () => {
    expect(crumbFold(0, 0)).toMatchObject({ rootShown: true, currentShown: true });
    expect(crumbFold(1, 0)).toMatchObject({ rootShown: false, currentShown: true });
    expect(crumbFold(2, 0)).toMatchObject({ rootShown: true, currentShown: false });
    expect(crumbFold(3, 0)).toMatchObject({ rootShown: false, currentTruncates: true });
  });

  it("never shows a truncated title beside the root", () => {
    for (let step = 0; step <= lastFoldStep(4); step += 1) {
      const fold = crumbFold(step, 4);
      expect(fold.currentTruncates && fold.rootShown).toBe(false);
    }
  });

  it("refuses a step past the last one", () => {
    expect(() => crumbFold(lastFoldStep(2) + 1, 2)).toThrow(RangeError);
  });
});

describe("lastFoldStep", () => {
  it("is every middle folded, then three steps more", () => {
    expect(lastFoldStep(0)).toBe(3);
    expect(lastFoldStep(4)).toBe(7);
  });
});
