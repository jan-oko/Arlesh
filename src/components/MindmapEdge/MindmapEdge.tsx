import type { Orientation, Position } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";
import { computeEdgePath } from "@/utils/edge-path";

interface Props {
  from: Position;
  to: Position;
  /** Rendered heights of the two nodes — unlike the per-depth widths, these grow with wrapped titles. */
  fromHeight: number;
  toHeight: number;
  orientation: Orientation;
}

export default function MindmapEdge({ from, to, fromHeight, toHeight, orientation }: Props) {
  const path = computeEdgePath(
    { x: from.x, y: from.y, halfWidth: getNodeSize(from.depth).width / 2, halfHeight: fromHeight / 2 },
    { x: to.x, y: to.y, halfWidth: getNodeSize(to.depth).width / 2, halfHeight: toHeight / 2 },
    orientation,
  );

  return <path d={path} stroke="var(--edge-color)" strokeWidth={1.5} fill="none" />;
}
