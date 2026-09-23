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
  it("draws a pending wait as an open ring, with no fill", () => {
    const icon = draw("pending", false);
    expect(icon.querySelectorAll("path")).toHaveLength(1);
    expect(icon.querySelector("path")?.getAttribute("fill")).toBe("none");
  });

  it("draws a released wait as a solid disc", () => {
    const icon = draw("released", false);
    expect(icon.querySelector("circle")?.getAttribute("fill")).toBe("red");
    expect(icon.querySelector("path")).toBeNull();
  });

  it("strikes an archived wait through", () => {
    expect(draw("pending", true).querySelectorAll("path")).toHaveLength(2);
    expect(draw("released", true).querySelectorAll("path")).toHaveLength(2);
  });
});
