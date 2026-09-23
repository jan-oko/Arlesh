import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ExpectationIcon from "./ExpectationIcon";

function draw(status: string, r = 10) {
  const { container } = render(
    <svg><ExpectationIcon cx={10} cy={10} r={r} color="red" opacity={1} status={status} /></svg>,
  );
  return container;
}

/** The arc's endpoints, from an `M x y A rx ry 0 large 1 x y` path. */
function endpoints(path: Element | null): [number, number, number, number] {
  const numbers = (path?.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [numbers[0] ?? NaN, numbers[1] ?? NaN, numbers[7] ?? NaN, numbers[8] ?? NaN];
}

describe("ExpectationIcon", () => {
  it("draws a pending wait as one solid arc over the top and four dashes below, round-capped, unfilled", () => {
    const icon = draw("pending");
    const [x0, y0, x1, y1] = endpoints(icon.querySelector('[data-part="solid"]'));
    // Left to right, both ends a little above the centre line: the arc spans the top half.
    expect(x0).toBeLessThan(10);
    expect(x1).toBeGreaterThan(10);
    expect(y0).toBeLessThan(10);
    expect(y1).toBeLessThan(10);
    expect(icon.querySelectorAll('[data-part="dash"]')).toHaveLength(4);
    for (const path of icon.querySelectorAll("path")) {
      expect(path.getAttribute("fill")).toBe("none");
      expect(path.getAttribute("stroke-linecap")).toBe("round");
      expect(path.getAttribute("stroke-dasharray")).toBeNull();
    }
    expect(icon.querySelector('[data-part="check"]')).toBeNull();
  });

  it("stays open at the lower right: no dash ends right of the centre above the ring's lower third", () => {
    const icon = draw("pending");
    for (const dash of icon.querySelectorAll('[data-part="dash"]')) {
      const [xa, ya, xb, yb] = endpoints(dash);
      for (const [x, y] of [[xa, ya], [xb, yb]]) {
        if (x === undefined || y === undefined) continue;
        if (x > 10) expect(y).toBeGreaterThan(14);
      }
    }
  });

  it("collapses to three dashes on an icon too small for four to stay apart", () => {
    expect(draw("pending", 5).querySelectorAll('[data-part="dash"]')).toHaveLength(3);
  });

  it("draws a released wait as the same ring with a check inside", () => {
    const icon = draw("released");
    expect(icon.querySelector('[data-part="solid"]')).not.toBeNull();
    expect(icon.querySelectorAll('[data-part="dash"]')).toHaveLength(4);
    expect(icon.querySelector('[data-part="check"]')).not.toBeNull();
  });

  it("is still: nothing animates", () => {
    expect(draw("pending").querySelector("animate, animateTransform")).toBeNull();
  });
});
