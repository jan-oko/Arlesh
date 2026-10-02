import { describe, it, expect } from "vitest";
import { altEnterStep, backlogClearedMessage, nextTaskStatus } from "@/utils/task-status-cycle";
import { agentic, ordinary } from "@/utils/status-mapping";

describe("nextTaskStatus — the Enter cycle", () => {
  it("goes To Do → In Progress → Done → To Do on an ordinary task", () => {
    expect(nextTaskStatus(ordinary("todo"))).toEqual(ordinary("in_progress"));
    expect(nextTaskStatus(ordinary("in_progress"))).toEqual(ordinary("done"));
    expect(nextTaskStatus(ordinary("done"))).toEqual(ordinary("todo"));
  });

  it("resumes a Started task to In Progress", () => {
    expect(nextTaskStatus(ordinary("started"))).toEqual(ordinary("in_progress"));
  });

  it("goes Review → Doing → Done → To Do → Doing on an agentic task", () => {
    expect(nextTaskStatus(agentic("review"))).toEqual(agentic("doing"));
    expect(nextTaskStatus(agentic("doing"))).toEqual(agentic("done"));
    expect(nextTaskStatus(agentic("done"))).toEqual(agentic("todo"));
    expect(nextTaskStatus(agentic("todo"))).toEqual(agentic("doing"));
  });

  it("takes an On Agent task over: Doing", () => {
    expect(nextTaskStatus(agentic("on_agent"))).toEqual(agentic("doing"));
  });

  it("never leaves the model the task holds", () => {
    for (const status of ["todo", "on_agent", "review", "doing", "done"] as const) {
      expect(nextTaskStatus(agentic(status)).kind).toBe("agentic");
    }
    for (const status of ["todo", "in_progress", "started", "done"] as const) {
      expect(nextTaskStatus(ordinary(status)).kind).toBe("ordinary");
    }
  });
});

describe("altEnterStep — Alt+Enter", () => {
  it("sets To Do and Done Started on an ordinary task", () => {
    expect(altEnterStep(ordinary("todo"))).toEqual({ next: ordinary("started") });
    expect(altEnterStep(ordinary("done"))).toEqual({ next: ordinary("started") });
  });

  it("flips In Progress and Started: pause and resume", () => {
    expect(altEnterStep(ordinary("in_progress"))).toEqual({ next: ordinary("started") });
    expect(altEnterStep(ordinary("started"))).toEqual({ next: ordinary("in_progress") });
  });

  it("hands a Doing agentic task back to the agent", () => {
    expect(altEnterStep(agentic("doing"))).toEqual({ next: agentic("on_agent") });
  });

  it("refuses on an agentic task anywhere else, out loud", () => {
    for (const status of ["todo", "on_agent", "review", "done"] as const) {
      expect(altEnterStep(agentic(status))).toEqual({ refused: "altEnterAgenticNotDoing" });
    }
  });
});

describe("backlogClearedMessage", () => {
  it("names the status that brought the task out of the Backlog", () => {
    expect(backlogClearedMessage(ordinary("in_progress"))).toBe("backlogClearedByStart");
    expect(backlogClearedMessage(ordinary("started"))).toBe("backlogClearedByStarted");
    expect(backlogClearedMessage(agentic("doing"))).toBe("backlogClearedByStart");
  });
});
