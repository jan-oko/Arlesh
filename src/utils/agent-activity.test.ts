import { describe, it, expect } from "vitest";
import { agentActivityOf } from "./agent-activity";
import { agentic, ordinary } from "@/utils/status-mapping";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskStatus } from "@/api/tasks";

function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

function task(id: string, status: TaskStatus, children: MindmapNode[] = []): MindmapNode {
  return node(id, "task", { status: status.status, taskStatus: status }, children);
}

function board(): MindmapNode {
  return node("root", "aspect", {}, [
    task("asking", agentic("review"), [
      node("question", "expectation", { status: "pending", agentWaiting: { note: null, question: true, answer: null } }),
    ]),
    task("working", agentic("on_agent"), [
      node("ci", "expectation", { status: "pending", agentWaiting: { note: "CI", question: false, answer: null } }),
      node("put-away", "expectation", { status: "pending", archived: true, agentWaiting: { note: null, question: false, answer: null } }),
    ]),
    task("taken-over", agentic("doing")),
    task("agent-todo", agentic("todo")),
    task("my-task", ordinary("in_progress")),
    node("my-wait", "expectation", { status: "pending" }),
  ]);
}

describe("agentActivityOf", () => {
  it("counts Review tasks, agentic waits on something else, and On Agent tasks", () => {
    expect(agentActivityOf(board())).toEqual({ review: 1, waits: 1, onAgent: 1 });
  });

  it("counts nothing on a board with no agent at work", () => {
    expect(agentActivityOf(node("root", "aspect"))).toEqual({ review: 0, waits: 0, onAgent: 0 });
  });
});
