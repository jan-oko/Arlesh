import type { McpCatalogueNode, McpNodeKey, McpVisibility } from "@/api/mcp-access";
import { mcpNodeKeyString } from "@/api/mcp-access";
import type { SearchableNode } from "@/utils/mindmap-tree";
import type { NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";

/** One MCP root as the settings page lists it. */
export interface McpRootRow {
  key: McpNodeKey;
  /** Its title, or `null` when the row it names is gone from the catalogue. */
  title: string | null;
  kind: NodeKind | null;
  /** Its ancestors' titles, outermost first. */
  path: string[];
  /** Whether the MCP can actually see it — `false` for a root that is private or sits under one. */
  visible: boolean;
}

/** The kind a stored node is shown as: a domain-table row by its subtype, the rest by table. */
function displayKind(node: McpCatalogueNode): NodeKind | null {
  const kind = node.subtype ?? node.node_kind;
  return isNodeKind(kind) ? kind : null;
}

function parentKey(node: McpCatalogueNode): string | null {
  if (node.parent_kind === null || node.parent_id === null) return null;
  return mcpNodeKeyString({ node_kind: node.parent_kind, node_id: node.parent_id });
}

/** Ancestor titles of `node`, nearest first. Stops at the top of the board or at a cycle. */
function ancestorTitles(node: McpCatalogueNode, byKey: ReadonlyMap<string, McpCatalogueNode>): string[] {
  const titles: string[] = [];
  const seen = new Set<string>([mcpNodeKeyString(node)]);
  let cursor = parentKey(node);
  while (cursor !== null && !seen.has(cursor)) {
    const ancestor = byKey.get(cursor);
    if (ancestor === undefined) break;
    seen.add(cursor);
    titles.push(ancestor.title);
    cursor = parentKey(ancestor);
  }
  return titles;
}

function indexCatalogue(nodes: readonly McpCatalogueNode[]): Map<string, McpCatalogueNode> {
  return new Map(nodes.map((node) => [mcpNodeKeyString(node), node]));
}

/**
 * The roots, named and placed, in the order the backend lists them.
 *
 * `visible` is the backend's own resolution: a root it does not list as visible is hidden from the
 * MCP, which only privacy can do to a root.
 */
export function describeRoots(
  roots: readonly McpNodeKey[],
  nodes: readonly McpCatalogueNode[],
  visible: readonly McpVisibility[],
): McpRootRow[] {
  const byKey = indexCatalogue(nodes);
  const seen = new Set(visible.map((entry) => mcpNodeKeyString(entry)));
  return roots.map((key) => {
    const node = byKey.get(mcpNodeKeyString(key));
    return {
      key,
      title: node?.title ?? null,
      kind: node === undefined ? null : displayKind(node),
      path: node === undefined ? [] : ancestorTitles(node, byKey).reverse(),
      visible: seen.has(mcpNodeKeyString(key)),
    };
  });
}

/**
 * Every stored node that is not already a root, in the shape the node search (`Ctrl+O`'s combobox)
 * takes. The id is the node's key string, never parsed: {@link catalogueKeyOf} looks it up.
 */
export function rootCandidates(
  roots: readonly McpNodeKey[],
  nodes: readonly McpCatalogueNode[],
): SearchableNode[] {
  const byKey = indexCatalogue(nodes);
  const taken = new Set(roots.map((key) => mcpNodeKeyString(key)));
  const candidates: SearchableNode[] = [];
  for (const node of nodes) {
    const id = mcpNodeKeyString(node);
    const kind = displayKind(node);
    if (taken.has(id) || kind === null) continue;
    candidates.push({ id, title: node.title, kind, path: ancestorTitles(node, byKey) });
  }
  return candidates;
}

/** The node a search result's id names, or `undefined` when it names none. */
export function catalogueKeyOf(id: string, nodes: readonly McpCatalogueNode[]): McpNodeKey | undefined {
  const node = nodes.find((candidate) => mcpNodeKeyString(candidate) === id);
  return node === undefined ? undefined : { node_kind: node.node_kind, node_id: node.node_id };
}
