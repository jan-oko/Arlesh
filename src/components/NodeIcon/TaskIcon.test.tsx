import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TaskIcon from "./TaskIcon";

function draw(status: string, compound: boolean) {
  return render(
    <svg>
      <TaskIcon cx={10} cy={10} r={8} color="black" opacity={1} status={status} isBlocked={false} compound={compound} />
    </svg>,
  ).container;
}

describe("TaskIcon — Compound", () => {
  it.each(["todo", "in_progress", "started", "done"])("dashes the outer ring of a compound %s task", (status) => {
    const ring = draw(status, true).querySelector("circle[data-compound='true']");
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute("stroke-dasharray")).toMatch(/^[\d.]+ [\d.]+$/);
  });

  it.each(["todo", "in_progress", "started", "done"])("draws a whole ring for a %s task set by hand", (status) => {
    const container = draw(status, false);
    expect(container.querySelector("circle[stroke-dasharray]")).toBeNull();
  });
});

describe("TaskIcon — Agentic statuses", () => {
  it("draws On Agent with a glyph of its own", () => {
    expect(draw("on_agent", false).querySelector("[data-agentic-status='on_agent']")).not.toBeNull();
    expect(draw("on_agent", false).innerHTML).not.toEqual(draw("started", false).innerHTML);
  });

  it("draws Review as Started, marked so the two can still be told apart", () => {
    const review = draw("review", false);
    expect(review.querySelector("[data-agentic-status='review']")).not.toBeNull();
    expect(draw("started", false).querySelector("[data-agentic-status]")).toBeNull();
    const shapes = (container: HTMLElement) => Array.from(container.querySelectorAll("circle")).map((circle) => circle.outerHTML);
    expect(shapes(review)).toEqual(shapes(draw("started", false)));
  });

  it("draws Doing as In Progress, since it means the same to the user", () => {
    expect(draw("doing", false).innerHTML).toEqual(draw("in_progress", false).innerHTML);
  });
});
