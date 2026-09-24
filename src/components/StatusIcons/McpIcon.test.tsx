import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import McpIcon from "./McpIcon";
import AgenticIcon from "./AgenticIcon";

function drawn(icon: React.ReactElement) {
  const { container } = render(<svg>{icon}</svg>);
  return container;
}

describe("McpIcon", () => {
  it("draws an antenna: one straight mast, with a signal arc either side of its tip", () => {
    const icon = drawn(<McpIcon cx={6} cy={6} r={6} color="currentColor" />);

    const paths = [...icon.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "");
    const arcs = paths.filter((d) => d.includes(" A "));
    const lines = paths.filter((d) => !d.includes(" A "));
    expect(arcs).toHaveLength(2);
    expect(lines).toHaveLength(1);
    // One leg: a single segment, no tripod or splayed base.
    expect(lines[0]?.match(/ L /g)).toHaveLength(1);
  });

  it("radiates both arcs from a filled emitter dot on top of the mast", () => {
    const icon = drawn(<McpIcon cx={6} cy={6} r={6} color="currentColor" />);
    const emitter = icon.querySelector("circle");
    expect(emitter).not.toBeNull();
    const ex = Number(emitter?.getAttribute("cx"));
    const ey = Number(emitter?.getAttribute("cy"));

    const arcs = [...icon.querySelectorAll("path")]
      .map((path) => path.getAttribute("d") ?? "")
      .filter((d) => d.includes(" A "));
    for (const d of arcs) {
      const [startX, startY, radius, , , , , endX, endY] = d.replace(/[MA]/g, "").trim().split(/\s+/).map(Number);
      // Both ends of each arc sit one radius from the emitter, so the arc is centred on it.
      expect(Math.hypot((startX ?? 0) - ex, (startY ?? 0) - ey)).toBeCloseTo(radius ?? 0, 5);
      expect(Math.hypot((endX ?? 0) - ex, (endY ?? 0) - ey)).toBeCloseTo(radius ?? 0, 5);
    }
    // The mast starts under the dot rather than through it.
    const mast = [...icon.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "").find((d) => !d.includes(" A "));
    expect(Number(mast?.split(/\s+/)[2])).toBeGreaterThan(ey);
  });

  it("stays in open strokes, unlike the closed box of the Agentic bot head beside it", () => {
    expect(drawn(<McpIcon cx={6} cy={6} r={6} color="currentColor" />).querySelector("rect")).toBeNull();
    expect(drawn(<AgenticIcon cx={6} cy={6} r={6} color="currentColor" />).querySelector("rect")).not.toBeNull();
  });

  it("stays inside its badge box", () => {
    const icon = drawn(<McpIcon cx={6} cy={6} r={6} color="currentColor" />);
    const numbers = [...icon.querySelectorAll("path")]
      .flatMap((path) => (path.getAttribute("d") ?? "").split(/[^0-9.-]+/))
      .filter((token) => token !== "")
      .map(Number);

    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(12);
    }
  });
});
