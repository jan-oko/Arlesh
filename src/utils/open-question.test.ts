import { describe, expect, it } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import { isSendableAnswer, openQuestion } from "@/utils/open-question";

function wait(id: string, over: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id, kind: "expectation", title: id, status: "pending", position: 0, tagIds: [], children: [],
    agentWaiting: { note: "Red or blue?", question: true, answer: null },
    ...over,
  };
}

function task(children: MindmapNode[]): MindmapNode {
  return { id: "task-1", kind: "task", title: "t", position: 0, tagIds: [], children };
}

describe("openQuestion", () => {
  it("finds a pending agentic question under the task", () => {
    expect(openQuestion(task([wait("a")]))?.id).toBe("a");
  });

  it("passes over a wait on something else, a released one and an archived one", () => {
    const ci = wait("ci", { agentWaiting: { note: null, question: false, answer: null } });
    const released = wait("released", { status: "released" });
    const archived = wait("archived", { archived: true });
    const plain = wait("plain");
    delete plain.agentWaiting;
    expect(openQuestion(task([ci, released, archived, plain]))).toBeUndefined();
  });
});

describe("isSendableAnswer", () => {
  it("needs something besides whitespace", () => {
    expect(isSendableAnswer("  ")).toBe(false);
    expect(isSendableAnswer("Blue.")).toBe(true);
  });
});
