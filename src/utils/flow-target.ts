import type { MindmapNode } from "@/utils/tree-layout";
import type { TargetSelection } from "@/components/FlowEditorModal/FlowEditorModal";

/**
 * A tree node as a Flow Target Node value. Used to show a flow's parent as its **inherited** target
 * — a flow with no explicit target renders its instances under its parent — so the editor and the
 * start modal both offer the node the instances would actually land on.
 *
 * It lives here rather than beside one view because every surface that opens a Flow editor needs
 * it, and the Mindmap is no longer the only one.
 */
export function targetSelectionFor(node: MindmapNode | null | undefined): TargetSelection | null {
  if (node === null || node === undefined || node.id === "root") return null;
  const id = parseInt(node.id.split("-").pop() ?? "", 10);
  return Number.isNaN(id) ? null : { kind: node.kind, id, title: node.title };
}

/**
 * Nodes a Flow may target — those that can hold a Goal/Task instance. Phase 7.5 further narrows
 * this to targets whose Time Scope satisfies containment.
 */
export function flowTargetNodes(tree: MindmapNode): MindmapNode[] {
  const canHoldInstance = new Set(["aspect", "domain", "project", "goal", "task"]);
  const acc: MindmapNode[] = [];
  const walk = (node: MindmapNode): void => {
    if (node.id !== "root" && canHoldInstance.has(node.kind)) acc.push(node);
    node.children.forEach(walk);
  };
  walk(tree);
  return acc;
}

/** Every flow item in the tree, used to offer intra-flow dependency targets within the same flow. */
export function allFlowItemNodes(tree: MindmapNode): MindmapNode[] {
  const acc: MindmapNode[] = [];
  const walk = (node: MindmapNode): void => {
    if (node.kind === "flow_goal" || node.kind === "flow_task") acc.push(node);
    node.children.forEach(walk);
  };
  walk(tree);
  return acc;
}
