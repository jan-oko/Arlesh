import type { Position } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";

interface Props {
  from: Position;
  to: Position;
}

export default function MindmapEdge({ from, to }: Props) {
  const fromSize = getNodeSize(from.depth);
  const toSize = getNodeSize(to.depth);

  const goingRight = to.x >= from.x;
  const fromX = from.x + (goingRight ? fromSize.width / 2 : -fromSize.width / 2);
  const toX = to.x + (goingRight ? -toSize.width / 2 : toSize.width / 2);
  const midX = (fromX + toX) / 2;

  const path = `M ${fromX} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${toX} ${to.y}`;

  return <path d={path} stroke="var(--edge-color)" strokeWidth={1.5} fill="none" />;
}
