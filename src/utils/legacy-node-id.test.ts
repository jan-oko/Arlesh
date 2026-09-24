import { describe, it, expect } from "vitest";
import { legacyNodeId, migratedNodeId } from "./legacy-node-id";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";
import { uuidV5 } from "@/utils/uuid-v5";
import { ARLESH_NODE_NAMESPACE } from "@/utils/node-uuid";

function node(id: string, over: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children, ...over };
}

const root = node("task-r", occurrenceRow({ habitId: 3, itemType: "flow_root", itemId: 3, index: 2 }));
const item = node("task-i", occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 7, cycleId: 9, index: 2 }));
const check = node("task-c", {
  rowId: "c", origin: { kind: "check", wait_kind: "stored", wait_id: 4, due_at: "2026-07-10T02:00:00" },
});
const spawned = node("sw", { kind: "expectation", rowId: "s", origin: { kind: "spawned_wait", task_id: 5 } });
const tree = node("root", { kind: "domain" }, [root, item, check, spawned, node("task-1", { rowId: 1 })]);

describe("legacyNodeId", () => {
  it("spells an occurrence's pre-row key from its origin", () => {
    expect(legacyNodeId(root)).toBe("habit-3-2-virtual");
    expect(legacyNodeId(item)).toBe("habititem-flow_task-7-9-2-virtual");
  });

  it("re-mints a wait's derived node's old UUID", () => {
    expect(legacyNodeId(check)).toBe(uuidV5("expectation-check/4/2026-07-10T02:00:00", ARLESH_NODE_NAMESPACE));
    expect(legacyNodeId(spawned)).toBe(uuidV5("spawned-wait/5", ARLESH_NODE_NAMESPACE));
  });

  it("has nothing to say about a stored row, whose key never changed", () => {
    expect(legacyNodeId(node("task-1", { rowId: 1 }))).toBeUndefined();
  });
});

describe("migratedNodeId", () => {
  it("finds the node a saved old key names now", () => {
    expect(migratedNodeId(tree, "habititem-flow_task-7-9-2-virtual")).toBe("task-i");
    expect(migratedNodeId(tree, uuidV5("spawned-wait/5", ARLESH_NODE_NAMESPACE))).toBe("sw");
  });

  it("finds nothing for a key whose node is gone", () => {
    expect(migratedNodeId(tree, "habit-3-99-virtual")).toBeUndefined();
  });
});
