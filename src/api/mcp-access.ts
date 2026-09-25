import { invoke } from "./gesture";

/**
 * The MCP roots: the parts of the board the MCP endpoint may see (see docs/spec/mcp-server.md,
 * "Access").
 *
 * The MCP sees nothing until the user names a stored node as a root. Everything inside a root is
 * then visible to it, private nodes excepted, and an Agentic Task inside one is writable too. The
 * roots are rows of the board, so adding or removing one goes through the ordinary Gesture path
 * and Ctrl+Z reverses it.
 *
 * Resolution — which nodes a set of roots makes visible — is the backend's alone. The frontend
 * never works it out for itself: it asks {@link listMcpAccess} and draws what comes back.
 */

/** The table a stored node is a row of — every domain-table subtype is `domain`. */
export type McpNodeKind =
  | "domain" | "goal" | "task" | "commitment" | "expectation" | "info"
  | "flow" | "flow_goal" | "flow_task";

/** One stored node, as a root is named. */
export interface McpNodeKey {
  node_kind: McpNodeKind;
  node_id: number;
}

/** One stored node as the MCP access page lists it. */
export interface McpCatalogueNode extends McpNodeKey {
  /** For a domain-table row, its subtype (`aspect`, `project`, `domain` or `tag`). */
  subtype: string | null;
  /** Its title — an Info's body. */
  title: string;
  parent_kind: McpNodeKind | null;
  parent_id: number | null;
  is_private: boolean;
  agentic: boolean | null;
}

/** The roots, and every node that could be one. */
export interface McpAccessCatalogue {
  roots: McpNodeKey[];
  nodes: McpCatalogueNode[];
}

/** One stored node the MCP can see, and the root it is seen through. */
export interface McpVisibility extends McpNodeKey {
  root_kind: McpNodeKind;
  root_id: number;
}

/** The roots and every stored node, for the settings page. */
export async function fetchMcpAccessCatalogue(): Promise<McpAccessCatalogue> {
  return invoke<McpAccessCatalogue>("mcp_access_catalogue");
}

/**
 * Every stored node the MCP can see — what the "visible to the MCP" badge is drawn from.
 *
 * An answer of nothing at all reads as nobody visible rather than failing the board load that
 * asks: the badge is the only thing that depends on it.
 */
export async function listMcpAccess(): Promise<McpVisibility[]> {
  const visible = await invoke<McpVisibility[] | null | undefined>("list_mcp_access");
  return visible ?? [];
}

/** Makes one stored node an MCP root. A node that already is one is left as it is. */
export async function addMcpRoot(node: McpNodeKey): Promise<void> {
  return invoke<void>("add_mcp_root", { nodeKind: node.node_kind, nodeId: node.node_id });
}

/** Stops one node being an MCP root. */
export async function removeMcpRoot(node: McpNodeKey): Promise<void> {
  return invoke<void>("remove_mcp_root", { nodeKind: node.node_kind, nodeId: node.node_id });
}

/** A stable string for a node key, for maps and React keys. Never parsed back. */
export function mcpNodeKeyString(node: McpNodeKey): string {
  return `${node.node_kind}:${node.node_id}`;
}
