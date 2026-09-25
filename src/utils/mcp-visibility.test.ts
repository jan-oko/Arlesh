import { describe, it, expect } from "vitest";
import { applyMcpVisibility, storedKeyOf } from "@/utils/mcp-visibility";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

function node(kind: NodeKind, rowId: number | undefined, title: string, children: MindmapNode[] = []): MindmapNode {
  return {
    id: `${kind}-${rowId ?? "virtual"}-${title}`,
    ...(rowId === undefined ? { virtual: true } : { rowId }),
    kind,
    title,
    position: 0,
    tagIds: [],
    children,
  };
}

/** Growth › Arlesh (project 2) › Ship (goal 10) › Write (task 100) › its virtual wait; Body › Run. */
function tree() {
  const wait = node("expectation", undefined, "Waiting on Write");
  const write = node("task", 100, "Write", [wait]);
  const ship = node("goal", 10, "Ship", [write]);
  const arlesh = node("project", 2, "Arlesh", [ship]);
  const run = node("task", 110, "Run");
  const root: MindmapNode = {
    id: "root", kind: "aspect", title: "", position: 0, tagIds: [],
    children: [node("aspect", 1, "Growth", [arlesh]), node("aspect", 3, "Body", [run])],
  };
  return { root, arlesh, ship, write, wait, run };
}

describe("applyMcpVisibility", () => {
  it("stamps each listed node with the title of the root it is seen through", () => {
    const { root, arlesh, ship, write, run } = tree();

    applyMcpVisibility(root, [
      { node_kind: "domain", node_id: 2, root_kind: "domain", root_id: 2 },
      { node_kind: "goal", node_id: 10, root_kind: "domain", root_id: 2 },
      { node_kind: "task", node_id: 100, root_kind: "domain", root_id: 2 },
    ]);

    expect(arlesh.mcpVisibleVia).toBe("Arlesh");
    expect(ship.mcpVisibleVia).toBe("Arlesh");
    expect(write.mcpVisibleVia).toBe("Arlesh");
    expect(run.mcpVisibleVia).toBeUndefined();
  });

  it("gives a derived node its nearest stored ancestor's answer", () => {
    const { root, wait } = tree();

    applyMcpVisibility(root, [{ node_kind: "task", node_id: 100, root_kind: "task", root_id: 100 }]);

    expect(wait.mcpVisibleVia).toBe("Write");
  });

  it("does not let a stored node inherit — an unlisted one is invisible whatever is above it", () => {
    // A private task under a visible goal is exactly this: the backend leaves it out.
    const { root, ship, write } = tree();

    applyMcpVisibility(root, [{ node_kind: "goal", node_id: 10, root_kind: "goal", root_id: 10 }]);

    expect(ship.mcpVisibleVia).toBe("Ship");
    expect(write.mcpVisibleVia).toBeUndefined();
  });

  it("clears a stamp a previous load left once the node stops being visible", () => {
    const { root, write } = tree();
    applyMcpVisibility(root, [{ node_kind: "task", node_id: 100, root_kind: "task", root_id: 100 }]);

    applyMcpVisibility(root, []);

    expect(write.mcpVisibleVia).toBeUndefined();
    expect("mcpVisibleVia" in write).toBe(false);
  });
});

describe("storedKeyOf", () => {
  it("reads every domain-table kind as the domain table", () => {
    const domainKinds: NodeKind[] = ["aspect", "project", "domain", "tag"];
    for (const kind of domainKinds) {
      expect(storedKeyOf(node(kind, 4, "x"))).toEqual({ node_kind: "domain", node_id: 4 });
    }
  });

  it("has no key for a derived node or a folded Habit run", () => {
    expect(storedKeyOf(node("task", undefined, "check"))).toBeNull();
    expect(storedKeyOf(node("habit_group", 4, "run"))).toBeNull();
  });
});
