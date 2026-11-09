import { describe, expect, it } from "vitest";
import { clearanceFor, hasCutout, parsePx, readCutoutBands, type CutoutBands } from "./cutout";

const VIEWPORT = { width: 800, height: 360 };
const NONE: CutoutBands = { left: [], right: [], top: [], bottom: [] };

/** A style declaration carrying only the given custom properties. */
function styleWith(properties: Record<string, string>): CSSStyleDeclaration {
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value);
  return element.style;
}

/** A phone in landscape with the camera 120..160 px down the left edge, 30 px deep. */
const CAMERA_LEFT = styleWith({
  "--cutout-left-start": "120px",
  "--cutout-left-end": "160px",
  "--cutout-left-depth": "30px",
});

describe("parsePx", () => {
  it("reads a pushed length and takes 0 for an unset or odd value", () => {
    expect(parsePx("12.5px")).toBe(12.5);
    expect(parsePx("")).toBe(0);
    expect(parsePx("auto")).toBe(0);
  });
});

describe("readCutoutBands", () => {
  it("reads the band the activity pushed for a side, and none for the others", () => {
    const bands = readCutoutBands(CAMERA_LEFT, VIEWPORT, false);
    expect(bands.left).toEqual([{ start: 120, end: 160, depth: 30 }]);
    expect(bands.right).toEqual([]);
    expect(hasCutout(bands)).toBe(true);
  });

  it("finds no cutout where nothing was pushed", () => {
    expect(hasCutout(readCutoutBands(styleWith({}), VIEWPORT, true))).toBe(false);
  });

  it("adds a band per rounded corner only when asked, 0.3 of its radius deep", () => {
    const style = styleWith({ "--corner-tl": "40px", "--corner-br": "40px" });
    expect(hasCutout(readCutoutBands(style, VIEWPORT, false))).toBe(false);
    const bands = readCutoutBands(style, VIEWPORT, true);
    expect(bands.left).toEqual([{ start: 0, end: 40, depth: 12 }]);
    expect(bands.top).toEqual([{ start: 0, end: 40, depth: 12 }]);
    expect(bands.right).toEqual([{ start: 320, end: 360, depth: 12 }]);
    expect(bands.bottom).toEqual([{ start: 760, end: 800, depth: 12 }]);
  });
});

describe("clearanceFor", () => {
  const bands = readCutoutBands(CAMERA_LEFT, VIEWPORT, false);

  it("keeps a full-width bar overlapping the camera's span in by the camera's depth", () => {
    const bar = { left: 0, right: 800, top: 100, bottom: 150 };
    expect(clearanceFor(bar, bands, VIEWPORT)).toEqual({ left: 30, right: 0, top: 0, bottom: 0 });
  });

  it("leaves a row above or below the camera's span alone", () => {
    expect(clearanceFor({ left: 0, right: 800, top: 0, bottom: 100 }, bands, VIEWPORT).left).toBe(0);
    expect(clearanceFor({ left: 0, right: 800, top: 160, bottom: 200 }, bands, VIEWPORT).left).toBe(0);
  });

  it("asks only for what the row's own inset leaves under the camera", () => {
    expect(clearanceFor({ left: 12, right: 800, top: 130, bottom: 150 }, bands, VIEWPORT).left).toBe(18);
    expect(clearanceFor({ left: 40, right: 800, top: 130, bottom: 150 }, bands, VIEWPORT).left).toBe(0);
  });

  it("measures the right side from the right edge, and a top camera along the x axis", () => {
    const right = readCutoutBands(styleWith({
      "--cutout-right-start": "120px", "--cutout-right-end": "160px", "--cutout-right-depth": "30px",
    }), VIEWPORT, false);
    expect(clearanceFor({ left: 0, right: 800, top: 130, bottom: 150 }, right, VIEWPORT).right).toBe(30);
    const top = readCutoutBands(styleWith({
      "--cutout-top-start": "380px", "--cutout-top-end": "420px", "--cutout-top-depth": "24px",
    }), VIEWPORT, false);
    expect(clearanceFor({ left: 300, right: 500, top: 0, bottom: 100 }, top, VIEWPORT).top).toBe(24);
    expect(clearanceFor({ left: 0, right: 300, top: 0, bottom: 100 }, top, VIEWPORT).top).toBe(0);
  });

  it("asks for nothing with no bands", () => {
    expect(clearanceFor({ left: 0, right: 800, top: 0, bottom: 50 }, NONE, VIEWPORT)).toEqual({
      left: 0, right: 0, top: 0, bottom: 0,
    });
  });
});
