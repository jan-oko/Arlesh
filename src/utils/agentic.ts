import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskAgentic } from "@/api/tasks";
import { TASK_AGENTIC } from "@/api/tasks";

/**
 * Whether `node` reads as **Agentic** — work that suits being handed to an agent.
 *
 * Its own flag when it set one, and otherwise the nearest flagged ancestor's, which the backend
 * resolved onto `inheritedAgentic` (the load's facts). An explicit `false` is a
 * real answer and wins over an agentic ancestor, which is why the flag is read with `??` rather
 * than `||`.
 *
 * Tasks only. The flag inherits *through* Goals, Projects and Domains, so a Task under an agentic
 * Task still reads as agentic wherever it sits, but only a Task ever reads as agentic itself: an
 * agent performs actions, where a Goal is a desired state and a Commitment is kept rather than done.
 */
export function isAgentic(node: MindmapNode): boolean {
  if (node.kind !== "task") return false;
  return node.agentic ?? node.inheritedAgentic ?? false;
}

/** The three-state value an editor shows for a task's **own** stored flag: absent or `null` is the
 * unchosen state that inherits, and `true`/`false` are the two answers a task can give itself. */
export function storedAgenticState(flag: boolean | null | undefined): TaskAgentic {
  if (flag === null || flag === undefined) return TASK_AGENTIC.INHERIT;
  return flag ? TASK_AGENTIC.YES : TASK_AGENTIC.NO;
}

/**
 * The state one press of the Agentic key writes: the opposite of what the task currently **reads
 * as**, resolved through {@link isAgentic}. Agentic → explicit *Not agentic*, anything else →
 * explicit *Agentic*.
 *
 * A two-state toggle over the resolved value rather than a cycle through the stored one, because
 * the flag stores three states but a Task only ever shows two. *Inherit* under a non-agentic parent
 * and an explicit *Not agentic* are the same picture, so a cycle that stepped between them spent a
 * press changing nothing the eye could catch — marking a fresh Task agentic appeared to take two.
 * Reading what the Task resolves to collapses the pair: every press flips the badge.
 *
 * *Inherit* is therefore a starting point the key resolves through, never a destination it writes.
 * Returning a Task to inheriting is the editor's job — the price of no press being invisible, and
 * the reason the editor still offers all three.
 */
export function toggledAgenticState(node: MindmapNode): TaskAgentic {
  return isAgentic(node) ? TASK_AGENTIC.NO : TASK_AGENTIC.YES;
}
