import { describe, it, expect } from "vitest";
import { computeEdgePath } from "./edge-path";
import type { EdgeEndpoint } from "./edge-path";

function endpoint(x: number, y: number): EdgeEndpoint {
  return { x, y, halfWidth: 100, halfHeight: 26 };
}

describe("computeEdgePath — horizontal", () => {
  it("leaves the right edge of the parent and meets the left edge of a child to its right", () => {
    const path = computeEdgePath(endpoint(0, 0), endpoint(220, 90), "horizontal");
    expect(path).toBe("M 100 0 C 110 0, 110 90, 120 90");
  });

  it("mirrors onto the left edges for a child to the left", () => {
    const path = computeEdgePath(endpoint(0, 0), endpoint(-220, 90), "horizontal");
    expect(path).toBe("M -100 0 C -110 0, -110 90, -120 90");
  });
});

describe("computeEdgePath — vertical", () => {
  it("leaves the bottom edge of the parent and meets the top edge of a child below", () => {
    const path = computeEdgePath(endpoint(0, 0), endpoint(220, 90), "vertical");
    expect(path).toBe("M 0 26 C 0 45, 220 45, 220 64");
  });

  it("mirrors onto the top and bottom edges for a child above", () => {
    const path = computeEdgePath(endpoint(0, 0), endpoint(220, -90), "vertical");
    expect(path).toBe("M 0 -26 C 0 -45, 220 -45, 220 -64");
  });

  it("holds each end's x through its control point, so the curve bends along y", () => {
    const path = computeEdgePath(endpoint(-40, 0), endpoint(60, 90), "vertical");
    expect(path).toBe("M -40 26 C -40 45, 60 45, 60 64");
  });

  it("respects differing node heights at each end", () => {
    const from: EdgeEndpoint = { x: 0, y: 0, halfWidth: 100, halfHeight: 40 };
    const to: EdgeEndpoint = { x: 0, y: 100, halfWidth: 100, halfHeight: 15 };
    expect(computeEdgePath(from, to, "vertical")).toBe("M 0 40 C 0 62.5, 0 62.5, 0 85");
  });
});
