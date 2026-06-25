import type { MindmapNode, Position } from "@/utils/tree-layout";
import { computeLayout } from "@/utils/tree-layout";
import MindmapEdge from "@/components/MindmapEdge/MindmapEdge";
import MindmapNodeComponent from "@/components/MindmapNode/MindmapNode";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";

interface Props {
  root: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  dragTargetId: string | null;
  dragSourceId: string | null;
  hasClipboard: boolean;
  onSelect: (id: string | null) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string, startX: number, startY: number) => void;
  onStatusClick: (id: string) => void;
}

export default function MindmapTree({ root, collapsedNodeIds, selectedNodeId, editingNodeId, dragTargetId, dragSourceId, hasClipboard, onSelect, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onStatusClick }: Props) {
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
      if (!collapsedNodeIds.has(node.id)) collect(child);
    }
  }
  collect(root);

  return (
    <>
      {edges.map((edge) => <MindmapEdge key={edge.key} from={edge.from} to={edge.to} />)}
      {nodes.map((node) => {
        const pos = positions.get(node.id);
        if (pos === undefined) return null;
        return (
          <MindmapNodeComponent key={node.id} node={node} position={pos} isSelected={selectedNodeId === node.id} isCollapsed={collapsedNodeIds.has(node.id)} isDragTarget={dragTargetId === node.id} isDragSource={dragSourceId === node.id} hasClipboard={hasClipboard} onSelect={onSelect} onDoubleClick={onDoubleClick} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} isEditing={editingNodeId === node.id} onContextAction={onContextAction} onDragStart={onDragStart} onStatusClick={onStatusClick} />
        );
      })}
    </>
  );
}
