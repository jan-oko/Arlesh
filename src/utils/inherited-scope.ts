import type { TimeScope } from "@/api/time-scope";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Resolves every node's inherited Time Scope in one downward pass: a node reads the window of its
 * nearest ancestor that has one of its own, or `null` when nothing above it is scoped — the rule
 * the backend's containment and lifecycle derivation follow.
 *
 * The Task editor reads it to hold an explicit due within the window a Task inherits, and to tell
 * an Unscoped Task (which may carry a due of its own) from one that inherits its window (which
 * derives its due from it).
 *
 * Mutates the tree in place, as `propagateAgentic` beside it does.
 */
export function propagateInheritedScope(node: MindmapNode, inherited: TimeScope | null): void {
  node.inheritedTimeScope = inherited;
  const effective = node.timeScope ?? inherited;
  for (const child of node.children) {
    propagateInheritedScope(child, effective);
  }
}
