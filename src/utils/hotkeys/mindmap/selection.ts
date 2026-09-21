import type { MindmapNode } from "@/utils/tree-layout";

/**
 * What the Mindmap has selected. Every feature module below reads its target off this, so it is
 * the one slice they share — a feature's own callbacks live with its bindings, which is what keeps
 * two features out of each other's files.
 */
export interface MindmapSelectionContext {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  findNodeById: (id: string) => MindmapNode | undefined;
}

/** True when anything at all is selected — the guard most Mindmap bindings carry. */
export const hasSelection = (c: MindmapSelectionContext): boolean => c.selectedNodeId !== null;

/** The selected node, or undefined when nothing is selected or the id is no longer on the board. */
export function selectedNode(c: MindmapSelectionContext): MindmapNode | undefined {
  return c.selectedNodeId === null ? undefined : c.findNodeById(c.selectedNodeId);
}

/** True when the selected node exists and its kind is `kind`. */
export function selectedKindIs(kind: string): (c: MindmapSelectionContext) => boolean {
  return (c) => {
    const node = selectedNode(c);
    return node !== undefined && node.kind === kind;
  };
}

/** True when the selected node exists and its kind is none of `kinds`. */
export function selectedKindIsNot(...kinds: readonly string[]): (c: MindmapSelectionContext) => boolean {
  return (c) => {
    const node = selectedNode(c);
    return node !== undefined && !kinds.includes(node.kind);
  };
}
