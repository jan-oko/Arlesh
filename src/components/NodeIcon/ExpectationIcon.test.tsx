import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ExpectationIcon from "./ExpectationIcon";

function draw(status: string) {
  const { container } = render(
    <svg><ExpectationIcon cx={10} cy={10} r={10} color="red" opacity={1} status={status} /></svg>,
  );
  return container;
}

describe("ExpectationIcon", () => {
  it("draws a pending wait as a ring solid on one half and dashed on the other, with no fill", () => {
    const icon = draw("pending");
    expect(icon.querySelector('[data-part="solid"]')?.getAttribute("stroke-dasharray")).toBeNull();
    expect(icon.querySelector('[data-part="dashed"]')?.getAttribute("stroke-dasharray")).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?$/);
    for (const path of icon.querySelectorAll("path")) expect(path.getAttribute("fill")).toBe("none");
    expect(icon.querySelector('[data-part="check"]')).toBeNull();
    expect(icon.querySelector("circle")).toBeNull();
  });

  it("draws a released wait as the same ring with a check inside", () => {
    const icon = draw("released");
    expect(icon.querySelector('[data-part="solid"]')).not.toBeNull();
    expect(icon.querySelector('[data-part="dashed"]')).not.toBeNull();
    expect(icon.querySelector('[data-part="check"]')).not.toBeNull();
  });

  it("is still: nothing animates", () => {
    expect(draw("pending").querySelector("animate, animateTransform")).toBeNull();
  });
});
