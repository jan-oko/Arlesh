import { describe, it, expect } from "vitest";
import { catalogueKeyOf, describeRoots, rootCandidates } from "@/utils/mcp-roots";
import type { McpCatalogueNode, McpNodeKind } from "@/api/mcp-access";

function node(
  kind: McpNodeKind, id: number, title: string, parent: [McpNodeKind, number] | null,
  subtype: string | null = null,
): McpCatalogueNode {
  return {
    node_kind: kind, node_id: id, subtype, title,
    parent_kind: parent?.[0] ?? null, parent_id: parent?.[1] ?? null,
    is_private: false, agentic: null,
  };
}

const NODES: McpCatalogueNode[] = [
  node("domain", 1, "Growth", null, "aspect"),
  node("domain", 2, "Arlesh", ["domain", 1], "project"),
  node("goal", 10, "Ship", ["domain", 2]),
  node("task", 100, "Write docs", ["goal", 10]),
];

describe("describeRoots", () => {
  it("names each root with its kind and its path from the top of the board", () => {
    const rows = describeRoots(
      [{ node_kind: "task", node_id: 100 }],
      NODES,
      [{ node_kind: "task", node_id: 100, root_kind: "task", root_id: 100 }],
    );

    expect(rows).toEqual([{
      key: { node_kind: "task", node_id: 100 },
      title: "Write docs",
      kind: "task",
      path: ["Growth", "Arlesh", "Ship"],
      visible: true,
    }]);
  });

  it("reads a domain-table root by its subtype", () => {
    const [row] = describeRoots([{ node_kind: "domain", node_id: 2 }], NODES, []);
    expect(row?.kind).toBe("project");
  });

  it("marks a root the backend did not list as visible — a private one", () => {
    const [row] = describeRoots([{ node_kind: "goal", node_id: 10 }], NODES, []);
    expect(row?.visible).toBe(false);
  });

  it("keeps a root whose row is gone, unnamed, rather than dropping it silently", () => {
    const [row] = describeRoots([{ node_kind: "task", node_id: 9 }], NODES, []);
    expect(row).toMatchObject({ title: null, kind: null, path: [] });
  });
});

describe("rootCandidates", () => {
  it("offers every node that is not already a root, with its ancestors nearest first", () => {
    const candidates = rootCandidates([{ node_kind: "goal", node_id: 10 }], NODES);

    expect(candidates.map((candidate) => candidate.title)).toEqual(["Growth", "Arlesh", "Write docs"]);
    expect(candidates.find((candidate) => candidate.title === "Write docs")?.path)
      .toEqual(["Ship", "Arlesh", "Growth"]);
  });

  it("gives ids that lead back to the node they were made from", () => {
    const [growth] = rootCandidates([], NODES);
    expect(growth).toBeDefined();
    expect(catalogueKeyOf(growth?.id ?? "", NODES)).toEqual({ node_kind: "domain", node_id: 1 });
    expect(catalogueKeyOf("nothing", NODES)).toBeUndefined();
  });
});
