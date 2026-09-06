import type { MindmapNode, NodeKind, Orientation, Position } from "@/utils/tree-layout";
import { computeLayout } from "@/utils/tree-layout";
import { computeNodeDimensions } from "@/utils/node-meta";
import MindmapEdge from "@/components/MindmapEdge/MindmapEdge";
import MindmapNodeComponent from "@/components/MindmapNode/MindmapNode";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";

interface Props {
  root: MindmapNode;
  orientation: Orientation;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeIds: ReadonlySet<string>;
  editingNodeId: string | null;
  dragTargetId: string | null;
  dragSourceId: string | null;
  hasClipboard: boolean;
  onSelect: (id: string | null) => void;
  onCtrlClick?: (id: string) => void;
  onShiftClick?: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string, startX: number, startY: number) => void;
  onStatusClick: (id: string) => void;
}

export default function MindmapTree({ root, orientation, collapsedNodeIds, selectedNodeIds, editingNodeId, dragTargetId, dragSourceId, hasClipboard, onSelect, onCtrlClick, onShiftClick, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onStatusClick }: Props) {
  const positions = computeLayout(root, collapsedNodeIds, orientation);

  const edges: Array<{ from: Position; to: Position; fromHeight: number; toHeight: number; key: string }> = [];
  const nodes: MindmapNode[] = [];
  const parentKindById = new Map<string, NodeKind | null>();

  // Vertical edges meet the tops and bottoms of the boxes, so they need each node's rendered
  // height, which grows with the wrapped title.
  const renderedHeight = (node: MindmapNode, depth: number): number =>
    computeNodeDimensions(depth, node.title).height;

  function collect(node: MindmapNode, parentKind: NodeKind | null) {
    nodes.push(node);
    parentKindById.set(node.id, parentKind);
    const nodePos = positions.get(node.id);
    if (nodePos === undefined) return;
    for (const child of node.children) {
      const childPos = positions.get(child.id);
      if (childPos !== undefined) {
        edges.push({
          from: nodePos,
          to: childPos,
          fromHeight: renderedHeight(node, nodePos.depth),
          toHeight: renderedHeight(child, childPos.depth),
          key: `${node.id}-${child.id}`,
        });
      }
      if (!collapsedNodeIds.has(node.id)) collect(child, node.kind);
    }
  }
  collect(root, null);

  return (
    <>
      {edges.map((edge) => (
        <MindmapEdge key={edge.key} from={edge.from} to={edge.to} fromHeight={edge.fromHeight} toHeight={edge.toHeight} orientation={orientation} />
      ))}
      {nodes.map((node) => {
        const pos = positions.get(node.id);
        if (pos === undefined) return null;
        return (
          <MindmapNodeComponent
            key={node.id}
            node={node}
            parentKind={parentKindById.get(node.id) ?? null}
            position={pos}
            isSelected={selectedNodeIds.has(node.id)}
            isCollapsed={collapsedNodeIds.has(node.id)}
            isDragTarget={dragTargetId === node.id}
            isDragSource={dragSourceId === node.id}
            hasClipboard={hasClipboard}
            onSelect={onSelect}
            {...(onCtrlClick !== undefined ? { onCtrlClick } : {})}
            {...(onShiftClick !== undefined ? { onShiftClick } : {})}
            onDoubleClick={onDoubleClick}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            isEditing={editingNodeId === node.id}
            onContextAction={onContextAction}
            onDragStart={onDragStart}
            onStatusClick={onStatusClick}
          />
        );
      })}
    </>
  );
}
