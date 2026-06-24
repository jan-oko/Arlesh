import type { MindmapNode, Position } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";
import { gatherSubtreeItems, findNode } from "@/utils/mindmap-tree";

interface Props {
  placeholderPos: Position;
  targetPos: Position;
  subtreeLayout: Map<string, Position> | null;
  collapsedNodeIds: ReadonlySet<string>;
  dragSourceId: string | null;
  tree: MindmapNode;
}

export default function DragPlaceholder({
  placeholderPos,
  targetPos,
  subtreeLayout,
  collapsedNodeIds,
  dragSourceId,
  tree,
}: Props) {
  const { width, height } = getNodeSize(placeholderPos.depth);
  const fromSize = getNodeSize(targetPos.depth);
  const goingRight = placeholderPos.x >= targetPos.x;
  const fromX = targetPos.x + (goingRight ? fromSize.width / 2 : -fromSize.width / 2);
  const toX = placeholderPos.x + (goingRight ? -width / 2 : width / 2);
  const midX = (fromX + toX) / 2;
  const edgePath = `M ${fromX} ${targetPos.y} C ${midX} ${targetPos.y}, ${midX} ${placeholderPos.y}, ${toX} ${placeholderPos.y}`;

  const subtreeNodes: Array<{ id: string; x: number; y: number; depthAbs: number }> = [];
  const subtreeEdges: Array<{ key: string; fx: number; fy: number; fdepth: number; tx: number; ty: number; tdepth: number }> = [];

  if (subtreeLayout !== null && dragSourceId !== null) {
    const sourceNode = findNode(tree, dragSourceId);
    if (sourceNode !== undefined) {
      gatherSubtreeItems(
        sourceNode, subtreeLayout, collapsedNodeIds,
        placeholderPos.x, placeholderPos.y, placeholderPos.depth,
        true, subtreeNodes, subtreeEdges,
      );
    }
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      <path d={edgePath} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 3" fill="none" opacity={0.7} />
      <g transform={`translate(${placeholderPos.x - width / 2}, ${placeholderPos.y - height / 2})`}>
        <rect width={width} height={height} rx={6} fill="var(--accent)" fillOpacity={0.1} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 3" />
      </g>
      {subtreeEdges.map((edge) => {
        const efromSize = getNodeSize(edge.fdepth);
        const etoSize = getNodeSize(edge.tdepth);
        const eRight = edge.tx >= edge.fx;
        const ex = edge.fx + (eRight ? efromSize.width / 2 : -efromSize.width / 2);
        const ex2 = edge.tx + (eRight ? -etoSize.width / 2 : etoSize.width / 2);
        const emx = (ex + ex2) / 2;
        return (
          <path
            key={edge.key}
            d={`M ${ex} ${edge.fy} C ${emx} ${edge.fy}, ${emx} ${edge.ty}, ${ex2} ${edge.ty}`}
            stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 2" fill="none" opacity={0.55}
          />
        );
      })}
      {subtreeNodes.map((n) => {
        const sz = getNodeSize(n.depthAbs);
        return (
          <g key={n.id} transform={`translate(${n.x - sz.width / 2}, ${n.y - sz.height / 2})`}>
            <rect width={sz.width} height={sz.height} rx={6} fill="var(--accent)" fillOpacity={0.07} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 2" />
          </g>
        );
      })}
    </g>
  );
}
