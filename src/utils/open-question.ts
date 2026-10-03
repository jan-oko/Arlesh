import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The open agentic **question** under a Task — the wait that makes an On Agent Task read Review.
 * Which wait that is, is the backend's rule (`tasks::rules::review`, served as the load's
 * `open_question` fact); this finds that wait among the Task's children, to draw and to answer.
 * `undefined` when there is none.
 */
export function openQuestion(task: MindmapNode): MindmapNode | undefined {
  if (task.openQuestionId === undefined) return undefined;
  return task.children.find((child) => child.kind === "expectation" && child.rowId === task.openQuestionId);
}

/** Whether an answer is something to send: anything but whitespace. */
export function isSendableAnswer(answer: string): boolean {
  return answer.trim() !== "";
}
