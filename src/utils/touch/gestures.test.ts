import { describe, expect, it } from "vitest";
import { classifyRelease, classifyTwoFingerSwipe, isSecondTap, pinchScale } from "./gestures";

const at = (x: number, y: number, t: number) => ({ x, y, t });

describe("classifyRelease", () => {
  it("reads a finger that stayed put as a tap", () => {
    expect(classifyRelease(at(100, 100, 0), at(104, 103, 120))).toEqual({ kind: "tap" });
  });

  it("reads a quick, short move up as a flick", () => {
    expect(classifyRelease(at(100, 300, 0), at(102, 240, 150))).toEqual({ kind: "flickUp" });
  });

  it("leaves a slow move up to the scroll", () => {
    expect(classifyRelease(at(100, 300, 0), at(102, 240, 600))).toEqual({ kind: "none" });
  });

  it("leaves a long move up to the scroll, however fast", () => {
    expect(classifyRelease(at(100, 500, 0), at(100, 200, 150))).toEqual({ kind: "none" });
  });

  it("reads a long enough sideways move as a swipe that way", () => {
    expect(classifyRelease(at(100, 100, 0), at(190, 110, 300))).toEqual({ kind: "swipe", direction: "right" });
    expect(classifyRelease(at(200, 100, 0), at(100, 95, 300))).toEqual({ kind: "swipe", direction: "left" });
  });

  it("does not read a diagonal as either", () => {
    expect(classifyRelease(at(100, 100, 0), at(170, 160, 200))).toEqual({ kind: "none" });
  });
});

describe("isSecondTap", () => {
  it("pairs two taps close in time and place", () => {
    expect(isSecondTap(at(100, 100, 0), at(105, 102, 250))).toBe(true);
  });

  it("does not pair taps too far apart in time", () => {
    expect(isSecondTap(at(100, 100, 0), at(100, 100, 400))).toBe(false);
  });

  it("does not pair a tap with nothing", () => {
    expect(isSecondTap(null, at(100, 100, 0))).toBe(false);
  });
});

describe("two fingers", () => {
  it("reads two fingers moved together sideways as a swipe", () => {
    expect(classifyTwoFingerSwipe([at(100, 100, 0), at(160, 100, 0)], [at(0, 105, 200), at(60, 105, 200)])).toBe("left");
  });

  it("does not read a pinch as a swipe", () => {
    expect(classifyTwoFingerSwipe([at(100, 100, 0), at(160, 100, 0)], [at(0, 100, 200), at(300, 100, 200)])).toBeNull();
  });

  it("measures how far a pinch has spread", () => {
    expect(pinchScale([at(0, 0, 0), at(100, 0, 0)], [at(0, 0, 0), at(150, 0, 0)])).toBe(1.5);
  });
});
