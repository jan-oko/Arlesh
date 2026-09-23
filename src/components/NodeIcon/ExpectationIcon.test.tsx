import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ExpectationIcon from "./ExpectationIcon";

function draw(status: string, isArchived: boolean) {
  const { container } = render(
    <svg><ExpectationIcon cx={10} cy={10} r={10} color="red" opacity={1} status={status} isArchived={isArchived} /></svg>,
  );
  return container;
}

describe("ExpectationIcon", () => {
  it("draws a pending wait as a ring solid across the top and dashed across the bottom, with no fill", () => {
    const icon = draw("pending", false);
    const paths = icon.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    for (const path of paths) expect(path.getAttribute("fill")).toBe("none");
    const dashed = icon.querySelector('[data-part="dashed"]');
    expect(dashed?.getAttribute("stroke-dasharray")).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?$/);
    expect(icon.querySelectorAll("[stroke-dasharray]")).toHaveLength(1);
  });

  it("is still: nothing animates", () => {
    const icon = draw("pending", false);
    expect(icon.querySelector("animate, animateTransform")).toBeNull();
  });

  it("draws a released wait as a solid disc", () => {
    const icon = draw("released", false);
    expect(icon.querySelector("circle")?.getAttribute("fill")).toBe("red");
    expect(icon.querySelector("path")).toBeNull();
  });

  it("strikes an archived wait through", () => {
    expect(draw("pending", true).querySelectorAll("path")).toHaveLength(3);
    expect(draw("released", true).querySelectorAll("path")).toHaveLength(3);
  });
});
