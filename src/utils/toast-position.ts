import type { Position } from "@/utils/tree-layout";

/**
 * Where an anchored notice (see `AnchoredToast`) renders when its node has no laid-out
 * position — a fixed, always-visible spot near the canvas origin, chosen over vanishing.
 */
export const GLOBAL_TOAST_POSITION: Position = { x: 16, y: 16, depth: 0 };

/**
 * The anchor node's own laid-out position, or the global fallback when it has none — e.g. the
 * node sits under a collapsed ancestor, or outside the current `enterSubtree` scope. Never
 * `undefined`: the caller used to treat a missing position as "render nothing," which silently
 * destroyed the notice.
 */
export function resolveToastPosition(nodeId: string, positions: ReadonlyMap<string, Position>): Position {
  return positions.get(nodeId) ?? GLOBAL_TOAST_POSITION;
}
