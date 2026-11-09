import type { TaskStatus } from "@/api/tasks";
import { agentic, ordinary } from "@/utils/status-mapping";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { MindmapNode } from "@/utils/tree-layout";

/** Why `Alt+S` in the node search starts nothing. */
export type StartRefusal = "not_a_task" | "unsettled" | "compound" | "blocked";

/** What `Alt+S` does to a row: write a status, find it already there, or refuse. */
export type StartDecision =
  | { outcome: "write"; status: TaskStatus }
  | { outcome: "already"; status: TaskStatus }
  | { outcome: "refused"; reason: StartRefusal };

/**
 * What `Alt+S` on the highlighted row of the node search does. An ordinary Task goes to In Progress
 * (a Done one reopens to it); an Agentic one to Doing, the status the user holds it in. A Compound
 * Task has no status of its own and a blocked one may not be started, as `Enter` and `Alt+Enter` say
 * in the views. Anything that is not a Task, and a Task still being created, is refused.
 */
export function decideStart(node: MindmapNode | undefined): StartDecision {
  if (node?.kind !== "task") return { outcome: "refused", reason: "not_a_task" };
  if (node.taskStatus === undefined) return { outcome: "refused", reason: "unsettled" };
  if (node.compound === true) return { outcome: "refused", reason: "compound" };
  if (isNodeBlocked(node)) return { outcome: "refused", reason: "blocked" };
  const status = node.taskStatus.kind === "agentic" ? agentic("doing") : ordinary("in_progress");
  const there = node.taskStatus.kind === status.kind && node.taskStatus.status === status.status;
  return { outcome: there ? "already" : "write", status };
}
