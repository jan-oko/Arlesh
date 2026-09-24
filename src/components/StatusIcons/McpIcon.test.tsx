import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import McpIcon from "./McpIcon";
import AgenticIcon from "./AgenticIcon";

function drawn(icon: React.ReactElement) {
  const { container } = render(<svg>{icon}</svg>);
  return container;
}

describe("McpIcon", () => {
  it("draws an antenna: a mast, a tip and signal arcs either side", () => {
    const icon = drawn(<McpIcon cx={6} cy={6} r={6} color="currentColor" />);

    const arcs = [...icon.querySelectorAll("path")].filter((path) => path.getAttribute("d")?.includes(" A "));
    expect(arcs).toHaveLength(4);
    expect(icon.querySelectorAll("circle")).toHaveLength(1);
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
