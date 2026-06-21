import type { Position } from "@/utils/tree-layout";

interface Props {
  from: Position;
  to: Position;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 36;

export default function MindmapEdge({ from, to }: Props) {
  const fromX = from.x + (to.x > from.x ? NODE_WIDTH : 0);
  const fromY = from.y + NODE_HEIGHT / 2;
  const toX = to.x + (to.x > from.x ? 0 : NODE_WIDTH);
  const toY = to.y + NODE_HEIGHT / 2;
  const midX = (fromX + toX) / 2;

  const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

  return (
    <path
      d={path}
      stroke="var(--edge-color)"
      strokeWidth={1.5}
      fill="none"
    />
  );
}
