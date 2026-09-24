import type { MindmapNode, NodeExtent } from "@/utils/tree-layout";
import { computeNodeDimensions } from "@/utils/node-meta";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";

/**
 * The status-badge row's reach below a node's box: the gap to the row plus one badge's height.
 * Mirrors `StatusIconRow`'s ROW_GAP (11) and icon diameter (2 × 6).
 */
export const BADGE_ROW_HEIGHT = 11 + 2 * 6;

/**
 * How far a node reaches above and below its centre as the Mindmap draws it: its box, whose
 * height grows with the wrapped title, and — whenever it shows *any* status badge — the badge row
 * hanging under it. Every badge counts alike: a node whose only badge is "visible to the MCP"
 * reserves exactly the row a calendar or a tag would.
 */
export function measureMindmapNode(node: MindmapNode, depth: number): NodeExtent {
  const half = computeNodeDimensions(depth, node.title).height / 2;
  const badges = deriveStatusIndicators(node).length > 0 ? BADGE_ROW_HEIGHT : 0;
  return { above: half, below: half + badges };
}
