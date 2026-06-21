import type { MindmapNode, Position } from "@/utils/tree-layout";
import { computeLayout } from "@/utils/tree-layout";
import MindmapEdge from "./MindmapEdge";
import MindmapNodeComponent from "./MindmapNode";
import type { ContextMenuAction } from "./NodeContextMenu";

interface Props {
  root: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  dragTargetId: string | null;
  hasClipboard: boolean;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string) => void;
}

export default function MindmapTree({
  root,
  collapsedNodeIds,
  selectedNodeId,
  editingNodeId,
  dragTargetId,
  hasClipboard,
  onSelect,
  onDoubleClick,
  onCommitEdit,
  onCancelEdit,
  onContextAction,
  onDragStart,
  onDrop,
}: Props) {
  const positions = computeLayout(root, collapsedNodeIds);

  const edges: Array<{ from: Position; to: Position; key: string }> = [];
  const nodes: MindmapNode[] = [];

  function collect(node: MindmapNode) {
    nodes.push(node);
    const nodePos = positions.get(node.id);
    if (nodePos === undefined) return;
    for (const child of node.children) {
      const childPos = positions.get(child.id);
      if (childPos !== undefined) {
        edges.push({ from: nodePos, to: childPos, key: `${node.id}-${child.id}` });
      }
      if (!collapsedNodeIds.has(node.id)) {
        collect(child);
      }
    }
  }
  collect(root);

  return (
    <>
      {edges.map((edge) => (
        <MindmapEdge key={edge.key} from={edge.from} to={edge.to} />
      ))}
      {nodes.map((node) => {
        const pos = positions.get(node.id);
        if (pos === undefined) return null;
        return (
          <MindmapNodeComponent
            key={node.id}
            node={node}
            position={pos}
            isSelected={selectedNodeId === node.id}
            isCollapsed={collapsedNodeIds.has(node.id)}
            isDragTarget={dragTargetId === node.id}
            hasClipboard={hasClipboard}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            isEditing={editingNodeId === node.id}
            onContextAction={onContextAction}
            onDragStart={onDragStart}
            onDrop={onDrop}
          />
        );
      })}
    </>
  );
}
