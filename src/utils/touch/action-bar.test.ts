import { describe, expect, it } from "vitest";
import { ACTION_BAR_CAPACITY, actionContextFor, actionSlotsFor } from "./action-bar";

describe("actionContextFor", () => {
  it("reads the Plan View's own context there, whatever is selected", () => {
    expect(actionContextFor("plan", ["task"])).toBe("planView");
  });

  it("reads nothing with no selection, and several with more than one", () => {
    expect(actionContextFor("list", [])).toBe("nothing");
    expect(actionContextFor("mindmap", ["task", "goal"])).toBe("several");
  });

  it("reads a node's kind into the table's row", () => {
    expect(actionContextFor("list", ["task"])).toBe("task");
    expect(actionContextFor("list", ["commitment"])).toBe("commitment");
    expect(actionContextFor("zen", ["expectation"])).toBe("wait");
    expect(actionContextFor("mindmap", ["project"])).toBe("container");
    expect(actionContextFor("mindmap", ["flow"])).toBe("flow");
  });
});

describe("actionSlotsFor", () => {
  it("draws the five slots of a Task as the spec lists them", () => {
    expect(actionSlotsFor("task").map((slot) => slot.key)).toEqual(["status", "child", "plan", "dependency", "open"]);
  });

  it("fills a short context with Undo before More", () => {
    expect(actionSlotsFor("commitment").map((slot) => slot.key)).toEqual(["verdict", "child", "plan", "open", "undo"]);
  });

  it("does not add Undo twice where the context already has it", () => {
    expect(actionSlotsFor("several").map((slot) => slot.key)).toEqual(["status", "plan", "archive", "undo", "redo"]);
  });

  it("never draws more slots than the bar holds", () => {
    for (const context of ["nothing", "task", "commitment", "wait", "container", "flow", "several", "planView"] as const) {
      expect(actionSlotsFor(context).length).toBeLessThanOrEqual(ACTION_BAR_CAPACITY);
    }
  });
});
