import type { NodeCapabilities } from "@/api/mindmap";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether `node` may be done `capability` to — the backend's answer (`nodes::rules::capabilities`),
 * sent on the load's facts only for a row whose origin turns something off. Absent, everything is
 * allowed: a row made by hand, or a node built before a load.
 */
export function can(node: MindmapNode, capability: keyof NodeCapabilities): boolean {
  return node.capabilities?.[capability] ?? true;
}
