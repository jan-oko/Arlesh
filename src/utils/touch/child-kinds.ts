import { TYPED_CHILD_KINDS, isValidDropTarget, typedChildStoredKind } from "@/utils/node-meta";
import type { TypedChildKind } from "@/utils/node-meta";
import type { NodeKind } from "@/utils/tree-layout";
import { everyView } from "./command-ids";

/**
 * The kinds a new child of a `parentKind` node can be, in the typed-child chords' order, by the
 * parenting rule creating and re-parenting share (`isValidDropTarget`, over the kind a chord stores
 * under that parent: inside a Flow a Task is a flow item). The chords themselves still refuse the
 * cases a kind cannot see (a drawn node, a Commitment Flow's Goal), out loud.
 */
export function childKindsFor(parentKind: NodeKind): TypedChildKind[] {
  return TYPED_CHILD_KINDS.filter((kind) => isValidDropTarget(typedChildStoredKind(parentKind, kind), parentKind));
}

/**
 * The bindings that create a child of `kind`, tried in order: the Mindmap's `Shift+initial` chord
 * for it and, for a Task, every view's `Tab` (the List and Steps Views create Tasks and nothing
 * else). A kind none of the mounted view's bindings can make is not offered.
 */
export function createChildIds(kind: TypedChildKind): string[] {
  const typed = `mindmap.createTypedChild.${kind}`;
  return kind === "task" ? [typed, ...everyView("createChild")] : [typed];
}
