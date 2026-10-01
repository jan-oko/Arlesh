import { describe, it, expect } from "vitest";
import { agentActivityOf } from "./agent-activity";
import { propagateAgentic } from "@/utils/agentic";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

function board(): MindmapNode {
  const root = node("root", "aspect", {}, [
    node("agent-task", "task", { status: "in_progress", agentic: true }, [
      node("sub-step", "task", { status: "in_progress" }),
      node("opted-out", "task", { status: "in_progress", agentic: false }),
      node("question", "expectation", { status: "pending", agentWaiting: { note: null, question: true, answer: null } }),
      node("ci", "expectation", { status: "pending", agentWaiting: { note: "CI", question: false, answer: null } }),
      node("answered", "expectation", { status: "released", agentWaiting: { note: null, question: true, answer: "yes" } }),
      node("put-away", "expectation", { status: "pending", archived: true, agentWaiting: { note: null, question: false, answer: null } }),
    ]),
    node("agent-todo", "task", { status: "todo", agentic: true }),
    node("my-task", "task", { status: "in_progress" }),
    node("my-wait", "expectation", { status: "pending" }),
  ]);
  propagateAgentic(root, false);
  return root;
}

describe("agentActivityOf", () => {
  it("counts pending agentic questions, other agentic waits and Agentic Tasks In Progress", () => {
    expect(agentActivityOf(board())).toEqual({ questions: 1, waits: 1, inProgress: 2 });
  });

  it("counts nothing on a board with no agent at work", () => {
    expect(agentActivityOf(node("root", "aspect"))).toEqual({ questions: 0, waits: 0, inProgress: 0 });
  });
});
