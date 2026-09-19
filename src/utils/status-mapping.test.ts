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

  // "blocked" was removed as a Task status long ago; blocking is its own axis now. The mapping
  // used to keep a dead arm for it, which quietly turned an unrecognised status into a Frozen
  // Goal. Anything the mapping does not know reads as Active.
  it("maps an unrecognised task status to active", () => {
    expect(taskStatusToGoalStatus("blocked")).toBe("active");
    expect(taskStatusToGoalStatus("nonsense")).toBe("active");
  });
});
