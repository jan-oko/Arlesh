import type { MindmapNode } from "@/utils/tree-layout";
import { EXPECTATION_STATUS } from "@/api/expectation-status";

/**
 * The open agentic **question** under a Task — the wait that makes an On Agent Task read Review:
 * raised by an agent as a question, still pending and not archived, directly beneath the Task. The
 * backend derives Review from the same rule (`tasks::review`); this finds the wait to draw and to
 * answer. `undefined` when there is none.
 */
export function openQuestion(task: MindmapNode): MindmapNode | undefined {
  return task.children.find((child) => child.kind === "expectation"
    && child.agentWaiting?.question === true
    && child.status === EXPECTATION_STATUS.PENDING
    && child.archived !== true);
}

/** Whether an answer is something to send: anything but whitespace. */
export function isSendableAnswer(answer: string): boolean {
  return answer.trim() !== "";
}
