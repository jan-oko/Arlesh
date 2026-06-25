import { describe, it, expect } from "vitest";
import { computeNodeDimensions, getNodeSize } from "./node-meta";

describe("computeNodeDimensions", () => {
  it("matches getNodeSize height for a short single-word title", () => {
    const base = getNodeSize(0);
    const computed = computeNodeDimensions(0, "Hello");
    expect(computed.height).toBe(base.height);
    expect(computed.width).toBe(base.width);
    expect(computed.iconWidth).toBe(base.iconWidth);
  });

  it("returns minimum height for an empty title", () => {
    const { height } = computeNodeDimensions(0, "");
    expect(height).toBe(getNodeSize(0).height);
  });

  it("expands height for a title long enough to wrap to a third line", () => {
    // depth 0: charWidth ≈ 18*0.52 = 9.36, textArea = 200-32-4 = 164, charsPerLine ≈ 17
    // 40 chars → ceil(40/17) = 3 lines → height = 8 + 3*22 = 74 > minHeight=52
    const { height } = computeNodeDimensions(0, "A".repeat(40));
    expect(height).toBeGreaterThan(getNodeSize(0).height);
  });

  it("treats explicit \\n as a forced line break increasing height above single-line equivalent", () => {
    // "A\nB\nC" = 3 segments of 1 char each = 3 lines
    // 3 lines at depth 0: height = 8 + 3*22 = 74
    const threeLines = computeNodeDimensions(0, "A\nB\nC").height;
    const oneLine = computeNodeDimensions(0, "ABC").height;
    expect(threeLines).toBeGreaterThan(oneLine);
  });

  it("uses minimum height at greater depths", () => {
    const { height } = computeNodeDimensions(4, "short");
    expect(height).toBe(getNodeSize(4).height);
  });

  it("handles depth beyond the spec table by clamping to the last entry", () => {
    const d4 = computeNodeDimensions(4, "x");
    const d99 = computeNodeDimensions(99, "x");
    expect(d4.width).toBe(d99.width);
    expect(d4.height).toBe(d99.height);
  });

  it("returns lineCount 1 for a short title that fits on one line", () => {
    const { lineCount } = computeNodeDimensions(0, "short");
    expect(lineCount).toBe(1);
  });

  it("returns lineCount matching the number of estimated wrapped lines for a long title", () => {
    // depth 0: charsPerLine ≈ floor(164 / 9.36) = 17
    // 40 chars → ceil(40/17) = 3 lines
    const { lineCount } = computeNodeDimensions(0, "A".repeat(40));
    expect(lineCount).toBe(3);
  });

  it("returns lineCount equal to explicit newline segments for multi-line title", () => {
    const { lineCount } = computeNodeDimensions(0, "A\nB\nC");
    expect(lineCount).toBe(3);
  });
});
