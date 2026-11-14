import { describe, expect, it } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import { isReviewWait, isSendableAnswer, openWaits } from "@/utils/open-question";

function wait(id: string, over: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id, kind: "expectation", title: id, status: "pending", position: 0, tagIds: [], children: [],
    agentWaiting: { note: "Red or blue?", question: true, answer: null },
    ...over,
  };
}

/** A task holding `waits` off its tree, and the open ones the backend named, if any. */
function task(waits: MindmapNode[], openQuestionIds?: number[]): MindmapNode {
  return {
    id: "task-1", kind: "task", title: "t", position: 0, tagIds: [], children: [], agentWaits: waits,
    ...(openQuestionIds !== undefined ? { openQuestionIds } : {}),
  };
}

describe("openWaits", () => {
  it("finds the waits the backend named as the task's open ones, in its order", () => {
    const first = wait("a", { rowId: 1 });
    const second = wait("b", { rowId: 2 });
    const closed = wait("c", { rowId: 3 });
    expect(openWaits(task([first, second, closed], [2, 1])).map((open) => open.id)).toEqual(["b", "a"]);
  });

  it("finds nothing when the backend named no open wait", () => {
    expect(openWaits(task([wait("a", { rowId: 1 })]))).toEqual([]);
  });
});

describe("isReviewWait", () => {
  it("tells a review from a question by the review it carries", () => {
    const review = wait("r", { agentWaiting: { note: "Done", question: true, answer: null, review: { links: [], hand_tests: [] } } });
    expect(isReviewWait(review)).toBe(true);
    expect(isReviewWait(wait("q"))).toBe(false);
  });
});

describe("isSendableAnswer", () => {
  it("needs something besides whitespace", () => {
    expect(isSendableAnswer("  ")).toBe(false);
    expect(isSendableAnswer("Blue.")).toBe(true);
  });
});
