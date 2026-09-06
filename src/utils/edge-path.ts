import type { Orientation } from "@/utils/tree-layout";

/** One end of an edge: a node's centre plus the half-extents of its box. */
export interface EdgeEndpoint {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/**
 * An SVG cubic-bezier path joining two node boxes, edge to edge.
 *
 * The curve runs along the branch axis, so it leaves the sides of the boxes when horizontal and
 * their tops/bottoms when vertical, bending through the midpoint of that axis.
 */
export function computeEdgePath(from: EdgeEndpoint, to: EdgeEndpoint, orientation: Orientation): string {
  if (orientation === "vertical") {
    const goingDown = to.y >= from.y;
    const fromY = from.y + (goingDown ? from.halfHeight : -from.halfHeight);
    const toY = to.y + (goingDown ? -to.halfHeight : to.halfHeight);
    const midY = (fromY + toY) / 2;
    return `M ${from.x} ${fromY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${toY}`;
  }

  const goingRight = to.x >= from.x;
  const fromX = from.x + (goingRight ? from.halfWidth : -from.halfWidth);
  const toX = to.x + (goingRight ? -to.halfWidth : to.halfWidth);
  const midX = (fromX + toX) / 2;
  return `M ${fromX} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${toX} ${to.y}`;
}
