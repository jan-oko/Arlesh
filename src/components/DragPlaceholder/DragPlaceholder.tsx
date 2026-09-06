import type { MindmapNode, Orientation, Position } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";
import { computeEdgePath, type EdgeEndpoint } from "@/utils/edge-path";
import { gatherSubtreeItems, findNode } from "@/utils/mindmap-tree";

/** The dragged preview boxes carry no title, so their base per-depth size is their rendered size. */
function endpointAt(x: number, y: number, depth: number): EdgeEndpoint {
  const { width, height } = getNodeSize(depth);
  return { x, y, halfWidth: width / 2, halfHeight: height / 2 };
}

interface Props {
  placeholderPos: Position;
  targetPos: Position;
  subtreeLayout: Map<string, Position> | null;
  collapsedNodeIds: ReadonlySet<string>;
  dragSourceId: string | null;
  orientation: Orientation;
  tree: MindmapNode;
}

export default function DragPlaceholder({
  placeholderPos,
  targetPos,
  subtreeLayout,
  collapsedNodeIds,
  dragSourceId,
  orientation,
  tree,
}: Props) {
  const { width, height } = getNodeSize(placeholderPos.depth);
  const edgePath = computeEdgePath(
    endpointAt(targetPos.x, targetPos.y, targetPos.depth),
    endpointAt(placeholderPos.x, placeholderPos.y, placeholderPos.depth),
    orientation,
  );

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
    <g pointerEvents="none">
      <path d={edgePath} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 3" fill="none" opacity={0.7} />
      <g transform={`translate(${placeholderPos.x - width / 2}, ${placeholderPos.y - height / 2})`}>
        <rect width={width} height={height} rx={6} fill="var(--accent)" fillOpacity={0.1} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 3" />
      </g>
      {subtreeEdges.map((edge) => (
        <path
          key={edge.key}
          d={computeEdgePath(
            endpointAt(edge.fx, edge.fy, edge.fdepth),
            endpointAt(edge.tx, edge.ty, edge.tdepth),
            orientation,
          )}
          stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 2" fill="none" opacity={0.55}
        />
      ))}
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
