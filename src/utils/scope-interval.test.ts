import { describe, it, expect } from "vitest";
import { intervalContains, intervalsOverlap } from "./scope-interval";

const WEEK = { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" };
const NEXT_WEEK = { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" };
const TUESDAY = { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" };
const SEPTEMBER = { start: "2026-09-01T00:00:00", end: "2026-10-01T00:00:00" };

describe("intervalContains", () => {
  it("holds for a day inside the week that spans it", () => {
    expect(intervalContains(WEEK, TUESDAY)).toBe(true);
  });

  it("holds for a window against itself", () => {
    expect(intervalContains(WEEK, WEEK)).toBe(true);
  });

  it("fails for a week that runs past the end of the month it starts in", () => {
    expect(intervalContains(SEPTEMBER, NEXT_WEEK)).toBe(false);
  });

  it("fails for the wider window inside the narrower one", () => {
    expect(intervalContains(TUESDAY, WEEK)).toBe(false);
  });
});

describe("intervalsOverlap", () => {
  it("holds for a week and a day within it", () => {
    expect(intervalsOverlap(WEEK, TUESDAY)).toBe(true);
    expect(intervalsOverlap(TUESDAY, WEEK)).toBe(true);
  });

  it("holds for a week that straddles a month boundary", () => {
    expect(intervalsOverlap(SEPTEMBER, NEXT_WEEK)).toBe(true);
  });

  it("fails for two adjacent weeks, because the windows are half-open", () => {
    expect(intervalsOverlap(WEEK, NEXT_WEEK)).toBe(false);
  });
});
