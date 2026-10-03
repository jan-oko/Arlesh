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

/** A task with `children`, and the open question the backend named beneath it, if any. */
function task(children: MindmapNode[], openQuestionId?: number): MindmapNode {
  return {
    id: "task-1", kind: "task", title: "t", position: 0, tagIds: [], children,
    ...(openQuestionId !== undefined ? { openQuestionId } : {}),
  };
}

describe("openQuestion", () => {
  it("finds the wait the backend named as the task's open question", () => {
    const named = wait("b", { rowId: 2 });
    expect(openQuestion(task([wait("a", { rowId: 1 }), named], 2))?.id).toBe("b");
  });

  it("finds nothing when the backend named no open question", () => {
    expect(openQuestion(task([wait("a", { rowId: 1 })]))).toBeUndefined();
  });
});

describe("isSendableAnswer", () => {
  it("needs something besides whitespace", () => {
    expect(isSendableAnswer("  ")).toBe(false);
    expect(isSendableAnswer("Blue.")).toBe(true);
  });
});
