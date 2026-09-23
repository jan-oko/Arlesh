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

  it("E on a check task says it can't be edited yet, and opens nothing else", () => {
    const result = setup();
    for (const id of ["check-3", "check-s", "check-9"]) {
      useMindmapStore.getState().clearToast();
      act(() => result.current.onDoubleClick(id));
      expect(result.current.editorModal).toBeNull();
      expect(useMindmapStore.getState().pendingToast?.message).toBe("editCheckTaskRefused");
    }
  });

  it("E on a spawned wait opens its Task's editor, and says so when the Task is gone", () => {
    const spawnedWait = node("sw-5", "expectation", { virtual: true, spawnedBy: { taskId: 5 } });
    const gone = node("sw-7", "expectation", { virtual: true, spawnedBy: { taskId: 7 } });
    const tree = node("root", "domain", { children: [task, spawnedWait, gone] });
    const result = renderHook(() => useNodeEditor({ tree, allTasksAndGoals: [], reload: vi.fn().mockResolvedValue(undefined) })).result;
    act(() => result.current.onDoubleClick("sw-5"));
    expect(result.current.editorModal?.node).toBe(task);
    act(() => result.current.setEditorModal(null));
    act(() => result.current.onDoubleClick("sw-7"));
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
