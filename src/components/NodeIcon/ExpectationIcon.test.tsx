import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ExpectationIcon from "./ExpectationIcon";

function draw(status: string, r = 20) {
  const { container } = render(
    <svg><ExpectationIcon cx={20} cy={20} r={r} color="red" opacity={1} status={status} /></svg>,
  );
  return container;
}

/** The angle of a tick's outer end, in degrees clockwise from twelve o'clock. */
function angleOf(path: Element, cx = 20, cy = 20): number {
  const numbers = (path.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const x = numbers[2] ?? NaN;
  const y = numbers[3] ?? NaN;
  return (Math.atan2(x - cx, cy - y) * 180 / Math.PI + 360) % 360;
}

describe("ExpectationIcon", () => {
  it("draws a pending wait as twenty equal round-capped ticks, unfilled, with no check", () => {
    const ticks = draw("pending").querySelectorAll('[data-part="tick"]');
    expect(ticks).toHaveLength(20);
    const widths = new Set([...ticks].map((tick) => tick.getAttribute("stroke-width")));
    expect(widths.size).toBe(1);
    for (const tick of ticks) {
      expect(tick.getAttribute("stroke-linecap")).toBe("round");
      expect(tick.getAttribute("fill")).toBe("none");
    }
    expect(draw("pending").querySelector('[data-part="check"]')).toBeNull();
  });

  it("leaves the ring open at the lower right, and only there", () => {
    const angles = [...draw("pending").querySelectorAll('[data-part="tick"]')].map((tick) => angleOf(tick));
    // Nothing between about four and a little before six o'clock...
    expect(angles.some((a) => a > 110 && a < 175)).toBe(false);
    // ...while the rest of the circle is ticked all the way round.
    for (const clock of [0, 90, 180, 270]) expect(angles.some((a) => Math.abs(a - clock) < 1)).toBe(true);
  });

  it("thins to ten ticks on a small icon, keeping the gap", () => {
    const ticks = [...draw("pending", 6).querySelectorAll('[data-part="tick"]')];
    expect(ticks).toHaveLength(10);
    expect(ticks.map((tick) => angleOf(tick)).some((a) => a > 110 && a < 175)).toBe(false);
  });

  it("draws a released wait as the same ring with a check inside", () => {
    const icon = draw("released");
    expect(icon.querySelectorAll('[data-part="tick"]')).toHaveLength(20);
    expect(icon.querySelector('[data-part="check"]')).not.toBeNull();
  });

  it("is still: nothing animates", () => {
    expect(draw("pending").querySelector("animate, animateTransform")).toBeNull();
  });
});
