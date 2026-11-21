import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The open agentic questions and reviews beneath a Task — the waits that make an On Agent Task read
 * Review — in position order. Which waits those are is the backend's rule (`tasks::rules::review`,
 * served as the load's `open_questions` fact); this finds them among the agentic waits the Task
 * holds, to draw and to answer. Empty when there are none.
 */
export function openWaits(task: MindmapNode): MindmapNode[] {
  const open = task.openQuestionIds ?? [];
  if (open.length === 0) return [];
  const held = task.agentWaits ?? [];
  return open.flatMap((id) => held.filter((wait) => wait.rowId === id));
}

/** Whether `wait` is a review — an agent's hand-back of finished work — rather than a question. */
export function isReviewWait(wait: MindmapNode): boolean {
  return wait.agentWaiting?.review !== undefined;
}

/** Whether an answer is something to send: anything but whitespace. */
export function isSendableAnswer(answer: string): boolean {
  return answer.trim() !== "";
}

/** Whether `wait` is **staged**: an answer is written and not yet sent. The backend's rule, read off
 * the Task's `stagedQuestionIds` (`tasks::rules::answer_drafts`); a draft on a wait that is not open
 * is stale and marks nothing. */
export function isWaitStaged(task: MindmapNode, wait: MindmapNode): boolean {
  return wait.rowId !== undefined && (task.stagedQuestionIds ?? []).includes(wait.rowId);
}

/** Whether the Task is marked staged: it has open questions or reviews, and **every** one is
 * staged, so nothing is left for the user but Send. Each wait is marked on its own either way. */
export function isTaskStaged(task: MindmapNode): boolean {
  const waits = openWaits(task);
  return waits.length > 0 && waits.every((wait) => isWaitStaged(task, wait));
}
