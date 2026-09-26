import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether a node reads **Overdue**: its window has fully passed, it is not done, and it is
 * Keep-on-exit — the lifecycle's own Resolution, derived by the backend, not a second definition.
 *
 * An Overdue Task's Plan is not bound by its own Time Scope, so work whose window passed unfinished
 * can be rescheduled into now or later without the window being widened on the user's behalf. The
 * backend lifts the same bound on the way in. A Missed task has been archived and a Completed one is
 * done, so neither is exempt; nor is a Habit occurrence, whose lifecycle never reads Overdue.
 */
export function isOverdue(node: MindmapNode): boolean {
  return node.resolution === "overdue";
}
