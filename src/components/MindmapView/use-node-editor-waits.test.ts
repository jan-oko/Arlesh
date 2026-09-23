import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import { updateExpectation } from "@/api/expectations";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { expectationNodeId } from "@/utils/node-uuid";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/domains", () => ({ listDomains: vi.fn().mockResolvedValue([]), updateDomain: vi.fn(), DOMAIN_SUBTYPE: { TAG: "tag" } }));
vi.mock("@/api/flows", () => ({ flowOrigins: vi.fn().mockResolvedValue([]) }));
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  updateExpectation: vi.fn().mockResolvedValue(undefined),
  addTagToExpectation: vi.fn().mockResolvedValue(undefined),
  removeTagFromExpectation: vi.fn().mockResolvedValue(undefined),
}));

function node(id: string, kind: MindmapNode["kind"], over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...over };
}

const check = node("check-3", "task", { virtual: true, expectationCheck: { kind: "stored", expectationId: 3 } });
const wait = node(expectationNodeId(3), "expectation", { rowId: 3, checkEvery: { n: 3, kind: "day" }, children: [check] });
const spawnedCheck = node("check-s", "task", { virtual: true, expectationCheck: { kind: "spawned", taskId: 5 } });
const task = node("task-5", "task", { rowId: 5, children: [spawnedCheck] });
const orphan = node("check-9", "task", { virtual: true, expectationCheck: { kind: "stored", expectationId: 9 } });
const root = node("root", "domain", { children: [wait, task, orphan] });

function setup() {
  return renderHook(() => useNodeEditor({ tree: root, allTasksAndGoals: [], reload: vi.fn().mockResolvedValue(undefined) })).result;
}

describe("useNodeEditor — waits", () => {
  beforeEach(() => { vi.clearAllMocks(); useMindmapStore.getState().clearToast(); });

  it("E on a check task opens its wait's editor, and on a spawned wait's check its Task's", () => {
    const result = setup();
    act(() => result.current.onDoubleClick("check-3"));
    expect(result.current.editorModal?.node).toBe(wait);
    act(() => result.current.onDoubleClick("check-s"));
    expect(result.current.editorModal?.node).toBe(task);
  });

  it("says so, rather than doing nothing, when what a check is drawn from is gone", () => {
    const result = setup();
    act(() => result.current.onDoubleClick("check-9"));
    expect(result.current.editorModal).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("editOwnerMissing");
  });

  it("sends a cleared Check every as an explicit null, so the backend clears it", async () => {
    const result = setup();
    act(() => result.current.setEditorModal({ nodeId: wait.id, node: wait }));
    await act(() => result.current.onExpectationSave({
      title: "wait", status: "pending", checkEvery: null, checkStartingDate: null, timeScope: null,
      tagIds: [], archived: false, isPrivate: false,
    }));
    const request = vi.mocked(updateExpectation).mock.calls[0]?.[1];
    expect(request).toHaveProperty("check_every", null);
    expect(JSON.parse(JSON.stringify(request))).toHaveProperty("check_every", null);
  });
});
