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

const CHECK = { kind: "check" as const, wait_kind: "stored" as const, wait_id: 3, due_at: "2026-07-10T02:00:00" };
const check = node("check-3", "task", { rowId: "c-3", origin: CHECK });
const wait = node(expectationNodeId(3), "expectation", { rowId: 3, checkEvery: { n: 3, kind: "day" }, children: [check] });
const task = node("task-5", "task", { rowId: 5 });
const root = node("root", "domain", { children: [wait, task] });

function setup() {
  return renderHook(() => useNodeEditor({ tree: root, allTasksAndGoals: [], reload: vi.fn().mockResolvedValue(undefined) })).result;
}

describe("useNodeEditor — waits", () => {
  beforeEach(() => { vi.clearAllMocks(); useMindmapStore.getState().clearToast(); });

  it("E on a check task opens its own editor: it is a Task row", () => {
    const result = setup();
    act(() => result.current.onDoubleClick("check-3"));
    expect(result.current.editorModal?.node).toBe(check);
  });

  it("E on a spawned wait opens its Task's editor, and says so when the Task is gone", () => {
    const spawnedWait = node("sw-5", "expectation", { rowId: "s-5", origin: { kind: "spawned_wait", task_id: 5 } });
    const gone = node("sw-7", "expectation", { rowId: "s-7", origin: { kind: "spawned_wait", task_id: 7 } });
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
      tagIds: [], archived: false, isPrivate: false, agentic: false, agenticNote: null,
    }));
    const request = vi.mocked(updateExpectation).mock.calls[0]?.[1];
    expect(request).toHaveProperty("check_every", null);
    expect(JSON.parse(JSON.stringify(request))).toHaveProperty("check_every", null);
  });
});
