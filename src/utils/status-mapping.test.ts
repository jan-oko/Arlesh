import { describe, it, expect } from "vitest";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "./status-mapping";

describe("goalStatusToTaskStatus", () => {
  it("maps active to todo", () => {
    expect(goalStatusToTaskStatus("active")).toBe("todo");
  });

  it("maps achieved to done", () => {
    expect(goalStatusToTaskStatus("achieved")).toBe("done");
  });

  it("maps frozen to todo", () => {
    expect(goalStatusToTaskStatus("frozen")).toBe("todo");
  });

  it("maps archived to todo", () => {
    expect(goalStatusToTaskStatus("archived")).toBe("todo");
  });
});

describe("taskStatusToGoalStatus", () => {
  it("maps todo to active", () => {
    expect(taskStatusToGoalStatus("todo")).toBe("active");
  });

  it("maps in_progress to active", () => {
    expect(taskStatusToGoalStatus("in_progress")).toBe("active");
  });

  it("maps done to achieved", () => {
    expect(taskStatusToGoalStatus("done")).toBe("achieved");
  });

  it("maps blocked to frozen", () => {
    expect(taskStatusToGoalStatus("blocked")).toBe("frozen");
  });
});
