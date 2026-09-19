import type { MindmapNode } from "@/utils/tree-layout";

/** No node is exempt — what every filter sees unless a view asks for a focus exemption. */
const NO_EXEMPTION: ReadonlySet<string> = new Set<string>();

/** Pushes `node` and, if the target is beneath it, the rest of the chain down to it, onto `path`. */
function collectPath(node: MindmapNode, targetId: string, path: string[]): boolean {
  path.push(node.id);
  if (node.id === targetId) return true;
  for (const child of node.children) {
    if (collectPath(child, targetId, path)) return true;
  }
  path.pop();
  return false;
}

/**
 * The ids held visible by the **focus exemption**: the focused node plus every ancestor needed to
 * reach it, and nothing else. The chain comes along because a node rendered without its parents
 * would be drawn detached — the Mindmap keeps a non-matching node only as the ancestor of a match.
 *
 * Empty when nothing is focused, or when the focused node is not inside `root` (it may sit outside
 * the subtree on screen), in which case every filter answers exactly as it did before.
 */
export function focusExemptPath(root: MindmapNode, focusedId: string | null): ReadonlySet<string> {
  if (focusedId === null) return NO_EXEMPTION;
  const path: string[] = [];
  if (!collectPath(root, focusedId, path)) return NO_EXEMPTION;
  return new Set(path);
}
