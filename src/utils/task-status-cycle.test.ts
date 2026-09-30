import { describe, it, expect } from "vitest";
import { backlogClearedMessage, nextStartedStatus, nextTaskStatus } from "@/utils/task-status-cycle";

describe("nextTaskStatus — the Enter cycle", () => {
  it("goes To Do → In Progress → Done → To Do", () => {
    expect(nextTaskStatus("todo")).toBe("in_progress");
    expect(nextTaskStatus("in_progress")).toBe("done");
    expect(nextTaskStatus("done")).toBe("todo");
  });

  it("resumes a Started task to In Progress", () => {
    expect(nextTaskStatus("started")).toBe("in_progress");
  });
});

describe("nextStartedStatus — Alt+Enter", () => {
  it("sets To Do and Done Started", () => {
    expect(nextStartedStatus("todo")).toBe("started");
    expect(nextStartedStatus("done")).toBe("started");
  });

  it("flips In Progress and Started: pause and resume", () => {
    expect(nextStartedStatus("in_progress")).toBe("started");
    expect(nextStartedStatus("started")).toBe("in_progress");
  });
});

describe("backlogClearedMessage", () => {
  it("names the status that brought the task out of the Backlog", () => {
    expect(backlogClearedMessage("in_progress")).toBe("backlogClearedByStart");
    expect(backlogClearedMessage("started")).toBe("backlogClearedByStarted");
  });
});
