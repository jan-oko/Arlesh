import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether a node is flagged **Overdue**: unfinished, not effectively archived, and past the end of
 * its due — the lifecycle's own flag, derived by the backend, not a second definition.
 *
 * An Overdue Task's Plan is not bound by its own Time Scope, so work past its due can be
 * rescheduled into now or later without the window being widened on the user's behalf. The
 * backend lifts the same bound on the way in. A Missed task has been archived and a Completed one is
 * done, so neither is exempt; nor, for now, is a Habit occurrence, which has no due yet.
 */
export function isOverdue(node: MindmapNode): boolean {
  return node.overdue === true;
}
