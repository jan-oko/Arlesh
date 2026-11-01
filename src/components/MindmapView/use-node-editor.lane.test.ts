import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import { runGesture } from "@/api/multi-node-gestures";
import { updateInfo } from "@/api/infos";
import { updateDomain } from "@/api/domains";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { deferred, lane, patchedFields, settleLane } from "@/test/lane-helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { message?: string }) => (options?.message === undefined ? key : `${key}: ${options.message}`),
  }),
}));
vi.mock("@/api/multi-node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/multi-node-gestures")>()),
  runGesture: vi.fn(),
}));
vi.mock("@/api/gesture", () => ({
  withAtomicGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
  withGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/api/domains", () => ({
  listDomains: vi.fn().mockResolvedValue([]),
  updateDomain: vi.fn(),
  DOMAIN_SUBTYPE: { TAG: "tag" },
}));
vi.mock("@/api/infos", () => ({ updateInfo: vi.fn() }));
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  scopeContainmentConflicts: vi.fn().mockResolvedValue([]),
}));

const taskNode: MindmapNode = {
  id: "task-5", rowId: 5, kind: "task", title: "Old title", tagIds: [], position: 0, children: [],
  status: "todo", taskStatus: { kind: "ordinary", status: "todo" },
};
const goalNode: MindmapNode = {
  id: "goal-2", rowId: 2, kind: "goal", title: "Goal", status: "active", tagIds: [], position: 0, children: [],
};
const infoNode: MindmapNode = {
  id: "info-3", rowId: 3, kind: "info", title: "Body", tagIds: [], position: 0, children: [],
};
const tagNode: MindmapNode = {
  id: "domain-4", rowId: 4, kind: "tag", title: "Tag", tagIds: [], position: 0, children: [],
};
const root: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", tagIds: [], position: 0, children: [taskNode, goalNode, infoNode, tagNode],
};

const taskSave: TaskSaveData = {
  title: "New title", status: { kind: "ordinary", status: "in_progress" }, blockReasons: [], tagIds: [],
  addedDeps: [], removedDeps: [], timeScope: null, onScopeExit: null, plan: null, archival: "live",
  agentic: "inherit", asynchronous: false, compound: false, asyncTemplate: null, agenticBrief: null, isPrivate: false,
};

function setup(node: MindmapNode) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useNodeEditor({ tree: root, allTasksAndGoals: [], reload }));
  act(() => hook.result.current.setEditorModal({ nodeId: node.id, node }));
  return { ...hook, reload };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingWritesStore.getState().reset();
  usePendingWritesStore.getState().reportBoard("test", { read: 0, epoch: null, revision: null });
  useMindmapStore.getState().clearToast();
  useClientModeStore.setState({ status: null });
});

describe("useNodeEditor — a Save through the lane", () => {
  it("closes the editor and shows the saved own fields before the write resolves", async () => {
    const held = deferred<unknown[]>();
    vi.mocked(runGesture).mockReturnValue(held.promise);
    const { result, reload } = setup(taskNode);

    await act(async () => { await result.current.onTaskSave(taskSave); });

    expect(result.current.editorModal).toBeNull();
    expect(patchedFields()[0]).toMatchObject({
      title: "New title", status: "in_progress", taskStatus: { kind: "ordinary", status: "in_progress" },
    });
    // No derived field is in the patch, and nothing reloaded yet.
    expect(patchedFields()[0]).not.toHaveProperty("overdue");
    expect(patchedFields()[0]).not.toHaveProperty("inheritedPlan");
    expect(reload).not.toHaveBeenCalled();
    await waitFor(() => expect(runGesture).toHaveBeenCalledTimes(1));

    held.resolve([]);
    await settleLane();
    expect(lane().every((write) => write.state === "answered")).toBe(true);
  });

  it("rolls back, toasts once and reopens the editor on the user's input and the reason", async () => {
    vi.mocked(runGesture).mockRejectedValue(new Error("Plan must sit inside the Time Scope"));
    const { result } = setup(taskNode);

    await act(async () => { await result.current.onTaskSave(taskSave); });
    await settleLane();

    expect(lane()).toEqual([]);
    expect(useMindmapStore.getState().pendingToast).toMatchObject({
      nodeId: "task-5", message: "saveFailed: Plan must sit inside the Time Scope",
    });
    expect(result.current.editorModal).toMatchObject({
      nodeId: "task-5",
      reopened: { kind: "task", draft: taskSave, error: "Plan must sit inside the Time Scope" },
    });
  });

  it("does not reopen over an editor the user opened meanwhile", async () => {
    const held = deferred<unknown[]>();
    vi.mocked(runGesture).mockReturnValue(held.promise);
    const { result } = setup(taskNode);
    await act(async () => { await result.current.onTaskSave(taskSave); });
    act(() => result.current.setEditorModal({ nodeId: goalNode.id, node: goalNode }));

    held.reject(new Error("refused"));
    await settleLane();

    expect(result.current.editorModal?.nodeId).toBe("goal-2");
    expect(result.current.editorModal?.reopened).toBeUndefined();
  });

  it("sends a Save queued behind a pending write on the same node after it", async () => {
    const first = deferred<{ outcome: "written"; response: { epoch: null; revision: null; fields: null; createdId: null } }>();
    usePendingWritesStore.getState().enqueue({
      nodeId: "task-5", label: "status change", patch: { kind: "fields", fields: { status: "started" } },
      send: () => first.promise, showToast: vi.fn(), unreachableMessage: "unreachable",
    });
    vi.mocked(runGesture).mockResolvedValue([]);
    const { result } = setup(taskNode);

    await act(async () => { await result.current.onTaskSave(taskSave); });
    expect(result.current.editorModal).toBeNull();
    expect(runGesture).not.toHaveBeenCalled();
    expect(lane()).toHaveLength(2);

    first.resolve({ outcome: "written", response: { epoch: null, revision: null, fields: null, createdId: null } });
    await waitFor(() => expect(runGesture).toHaveBeenCalledTimes(1));
  });

  it("leaves a Save queued behind a refused write unsent, and reopens its editor too", async () => {
    const first = deferred<never>();
    usePendingWritesStore.getState().enqueue({
      nodeId: "task-5", label: "status change", patch: { kind: "fields", fields: { status: "started" } },
      send: () => first.promise, showToast: vi.fn(), unreachableMessage: "unreachable",
    });
    const { result } = setup(taskNode);
    await act(async () => { await result.current.onTaskSave(taskSave); });

    first.reject(new Error("Compound tasks have no status"));
    await settleLane();

    expect(runGesture).not.toHaveBeenCalled();
    expect(lane()).toEqual([]);
    expect(result.current.editorModal?.reopened).toMatchObject({ kind: "task", error: "Compound tasks have no status" });
  });

  it("keeps the editor open with the board's notice on a read-only board, and patches nothing", async () => {
    useClientModeStore.setState({
      status: { mode: "client", server: { read_only: "server_unreachable" } },
    } as never);
    const { result } = setup(taskNode);

    await expect(act(async () => { await result.current.onTaskSave(taskSave); })).rejects.toThrow("banner.server_unreachable");

    expect(result.current.editorModal?.nodeId).toBe("task-5");
    expect(lane()).toEqual([]);
    expect(runGesture).not.toHaveBeenCalled();
  });

  it("saves a Goal, an Info and a Tag the same way", async () => {
    vi.mocked(runGesture).mockResolvedValue([]);
    vi.mocked(updateInfo).mockResolvedValue(undefined as never);
    vi.mocked(updateDomain).mockResolvedValue(undefined as never);
    const goalSave: GoalSaveData = {
      title: "Renamed goal", status: "achieved", blockReasons: [], tagIds: [], timeScope: null, onScopeExit: null, isPrivate: false,
    };
    const goal = setup(goalNode);
    await act(async () => { await goal.result.current.onGoalSave(goalSave); });
    expect(goal.result.current.editorModal).toBeNull();
    expect(patchedFields()[0]).toMatchObject({ title: "Renamed goal", status: "achieved" });
    await settleLane();

    const info = setup(infoNode);
    await act(async () => { await info.result.current.onInfoSave({ body: "New body", details: "trace", isPrivate: false }); });
    expect(info.result.current.editorModal).toBeNull();
    await settleLane();
    expect(updateInfo).toHaveBeenCalledWith(3, { body: "New body", details: "trace", is_private: false });

    const tag = setup(tagNode);
    await act(async () => { await tag.result.current.onSimpleSave("Renamed tag", false, undefined); });
    expect(tag.result.current.editorModal).toBeNull();
    await settleLane();
    expect(updateDomain).toHaveBeenCalledWith(4, { title: "Renamed tag", is_private: false });
  });
});
