import { describe, expect, it } from "vitest";
import { decideStart } from "./search-start";
import type { MindmapNode } from "@/utils/tree-layout";
import { agentic, ordinary } from "@/utils/status-mapping";

function node(extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: "task-1", kind: "task", title: "Write docs", position: 0, tagIds: [], children: [], ...extra };
}

describe("decideStart: what Alt+S in the node search does to a row", () => {
  it.each(["todo", "started", "done"] as const)("sends an ordinary %s Task to In Progress", (status) => {
    expect(decideStart(node({ taskStatus: ordinary(status) }))).toEqual({ outcome: "write", status: ordinary("in_progress") });
  });

  it.each(["todo", "on_agent", "review", "done"] as const)("sends an Agentic %s Task to Doing", (status) => {
    expect(decideStart(node({ taskStatus: agentic(status) }))).toEqual({ outcome: "write", status: agentic("doing") });
  });

  it("writes nothing for a Task already there, and says so", () => {
    expect(decideStart(node({ taskStatus: ordinary("in_progress") }))).toEqual({ outcome: "already", status: ordinary("in_progress") });
    expect(decideStart(node({ taskStatus: agentic("doing") }))).toEqual({ outcome: "already", status: agentic("doing") });
  });

  it("refuses a Compound Task, whose status follows its sub-items", () => {
    expect(decideStart(node({ taskStatus: ordinary("todo"), compound: true }))).toEqual({ outcome: "refused", reason: "compound" });
  });

  it("refuses a blocked Task, as Enter and Alt+Enter do", () => {
    expect(decideStart(node({ taskStatus: ordinary("todo"), blockReasons: ["waiting"] }))).toEqual({ outcome: "refused", reason: "blocked" });
  });

  it("refuses a row that is not a Task", () => {
    expect(decideStart(node({ kind: "goal" }))).toEqual({ outcome: "refused", reason: "not_a_task" });
    expect(decideStart(undefined)).toEqual({ outcome: "refused", reason: "not_a_task" });
  });

  it("refuses a Task still being created, whose model is the server's to say", () => {
    expect(decideStart(node())).toEqual({ outcome: "refused", reason: "unsettled" });
  });
});
