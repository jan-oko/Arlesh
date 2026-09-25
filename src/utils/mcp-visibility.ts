import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { McpNodeKey, McpNodeKind, McpVisibility } from "@/api/mcp-access";
import { mcpNodeKeyString } from "@/api/mcp-access";

/** The table each node kind is a row of; `null` for a kind that is never a row. */
const TABLE_OF_KIND: Record<NodeKind, McpNodeKind | null> = {
  aspect: "domain",
  project: "domain",
  domain: "domain",
  tag: "domain",
  goal: "goal",
  task: "task",
  commitment: "commitment",
  expectation: "expectation",
  info: "info",
  flow: "flow",
  flow_goal: "flow_goal",
  flow_task: "flow_task",
  habit_group: null,
};

/** The stored row a node draws, as the MCP roots name it — `null` for a derived node, whose row id
 * is a UUID string rather than a stored primary key. */
export function storedKeyOf(node: MindmapNode): McpNodeKey | null {
  if (node.virtual === true || typeof node.rowId !== "number") return null;
  const table = TABLE_OF_KIND[node.kind];
  if (table === null) return null;
  return { node_kind: table, node_id: node.rowId };
}

function visit(node: MindmapNode, each: (node: MindmapNode) => void): void {
  each(node);
  for (const child of node.children) visit(child, each);
}

/**
 * Stamps every node the MCP can see with the title of the root it is seen through, and clears the
 * stamp from every other node.
 *
 * `visible` is the backend's answer — which stored rows the MCP roots make visible — and this does
 * not second-guess it: a stored node is visible exactly when it is listed. A derived node (a Habit
 * occurrence, a wait's check task, a delegated Task's wait) is a row of nothing, so it takes the
 * answer of the nearest stored node above it.
 *
 * Mutates the tree in place, as the other load-time passes do.
 */
export function applyMcpVisibility(root: MindmapNode, visible: readonly McpVisibility[]): void {
  const titles = new Map<string, string>();
  visit(root, (node) => {
    const key = storedKeyOf(node);
    if (key !== null) titles.set(mcpNodeKeyString(key), node.title);
  });

  const via = new Map<string, string>();
  for (const entry of visible) {
    const rootKey = mcpNodeKeyString({ node_kind: entry.root_kind, node_id: entry.root_id });
    via.set(mcpNodeKeyString(entry), titles.get(rootKey) ?? "");
  }

  function stamp(node: MindmapNode, inherited: string | undefined): void {
    const key = storedKeyOf(node);
    const own = key === null ? inherited : via.get(mcpNodeKeyString(key));
    if (own === undefined) delete node.mcpVisibleVia;
    else node.mcpVisibleVia = own;
    for (const child of node.children) stamp(child, own);
  }
  stamp(root, undefined);
}
