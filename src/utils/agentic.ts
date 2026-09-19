import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskAgentic } from "@/api/tasks";
import { TASK_AGENTIC } from "@/api/tasks";

/**
 * Whether `node` reads as **Agentic** — work that suits being handed to an agent.
 *
 * Its own flag when it set one, and otherwise the nearest flagged ancestor's, which
 * {@link propagateAgentic} has already resolved onto `inheritedAgentic`. An explicit `false` is a
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

/**
 * Resolves every node's inherited Agentic value in one downward pass, mirroring the override rule
 * Delegation follows: a node with no flag of its own reads what its parent reads, and a node with
 * an explicit flag replaces it for its whole subtree.
 *
 * Non-Task kinds carry no flag of their own but still pass one down, so a Task nested under a
 * Goal under an agentic Task inherits from that Task rather than being cut off by the Goal.
 *
 * Mutates the tree in place, as the aspect-color pass beside it does: the tree is assembled once
 * per load and the inherited value is a property of a node's position in it.
 */
export function propagateAgentic(node: MindmapNode, inherited: boolean): void {
  node.inheritedAgentic = inherited;
  const effective = node.agentic ?? inherited;
  for (const child of node.children) {
    propagateAgentic(child, effective);
  }
}

/** The three-state value an editor shows for a task's **own** stored flag: absent or `null` is the
 * unchosen state that inherits, and `true`/`false` are the two answers a task can give itself. */
export function storedAgenticState(flag: boolean | null | undefined): TaskAgentic {
  if (flag === null || flag === undefined) return TASK_AGENTIC.INHERIT;
  return flag ? TASK_AGENTIC.YES : TASK_AGENTIC.NO;
}

/**
 * The state one press of the Agentic key moves to: **Inherit → Agentic → Not agentic → Inherit**.
 *
 * A cycle rather than a switch, because the flag has three states and the key has to reach all of
 * them — the two-state Backlog toggle it is modelled on has nothing to choose here. The order puts
 * *Agentic* one press from where every Task starts, since marking work agentic is the thing the key
 * exists for; *Not agentic* follows because it is the rarer answer, wanted only to carve a single
 * Task back out of an agentic branch.
 *
 * Closing the cycle is the point: every state is one to three presses from every other, so the key
 * can always undo itself and no state it reaches needs the editor to leave.
 */
export function nextAgenticState(current: TaskAgentic): TaskAgentic {
  if (current === TASK_AGENTIC.INHERIT) return TASK_AGENTIC.YES;
  if (current === TASK_AGENTIC.YES) return TASK_AGENTIC.NO;
  return TASK_AGENTIC.INHERIT;
}
