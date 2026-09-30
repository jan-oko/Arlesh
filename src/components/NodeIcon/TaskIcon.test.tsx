import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TaskIcon from "./TaskIcon";

function draw(status: string, consistent: boolean) {
  return render(
    <svg>
      <TaskIcon cx={10} cy={10} r={8} color="black" opacity={1} status={status} isBlocked={false} consistent={consistent} />
    </svg>,
  ).container;
}

describe("TaskIcon — Consistence", () => {
  it.each(["todo", "in_progress", "started", "done"])("dashes the outer ring of a consistent %s task", (status) => {
    const ring = draw(status, true).querySelector("circle[data-consistent='true']");
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute("stroke-dasharray")).toMatch(/^[\d.]+ [\d.]+$/);
  });

  it.each(["todo", "in_progress", "started", "done"])("draws a whole ring for a %s task set by hand", (status) => {
    const container = draw(status, false);
    expect(container.querySelector("circle[stroke-dasharray]")).toBeNull();
  });
});
