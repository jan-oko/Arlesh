import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import { runGesture } from "@/api/multi-node-gestures";
import { updateInfo } from "@/api/infos";
import { updateDomain } from "@/api/domains";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { storedRowId } from "@/test/stored-id";

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
  id: `task-${storedRowId(5)}`, rowId: storedRowId(5), kind: "task", title: "Old title", tagIds: [], position: 0, children: [],
  status: "todo", taskStatus: { kind: "ordinary", status: "todo" },
};
const goalNode: MindmapNode = {
  id: `goal-${storedRowId(2)}`, rowId: storedRowId(2), kind: "goal", title: "Goal", status: "active", tagIds: [], position: 0, children: [],
};
const infoNode: MindmapNode = {
  id: `info-${storedRowId(3)}`, rowId: storedRowId(3), kind: "info", title: "Body", tagIds: [], position: 0, children: [],
};
const tagNode: MindmapNode = {
  id: `domain-${storedRowId(4)}`, rowId: storedRowId(4), kind: "tag", title: "Tag", tagIds: [], position: 0, children: [],
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
  const settle = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useNodeEditor({ tree: root, allTasksAndGoals: [], settle }));
  act(() => hook.result.current.setEditorModal({ nodeId: node.id, node }));
  return { ...hook, settle };
}

beforeEach(() => {
  vi.clearAllMocks();
  useClientModeStore.setState({ status: null });
});

describe("useNodeEditor: a Save is one awaited write", () => {
  it("writes the Save and closes the editor once the backend has answered", async () => {
    vi.mocked(runGesture).mockResolvedValue([]);
    const { result } = setup(taskNode);

    await act(async () => { await result.current.onTaskSave(taskSave); });

    expect(runGesture).toHaveBeenCalledTimes(1);
    expect(result.current.editorModal).toBeNull();
  });

  it("keeps the editor open and passes the reason on when the write is refused", async () => {
    vi.mocked(runGesture).mockRejectedValue(new Error("Plan must sit inside the Time Scope"));
    const { result } = setup(taskNode);

    await expect(act(async () => { await result.current.onTaskSave(taskSave); })).rejects.toThrow("Plan must sit inside the Time Scope");

    expect(result.current.editorModal?.nodeId).toBe(`task-${storedRowId(5)}`);
  });

  it("keeps the editor open with the board's notice on a read-only board, and sends nothing", async () => {
    useClientModeStore.setState({
      status: { mode: "client", server: { read_only: "server_unreachable" } },
    } as never);
    const { result } = setup(taskNode);

    await expect(act(async () => { await result.current.onTaskSave(taskSave); })).rejects.toThrow("banner.server_unreachable");

    expect(result.current.editorModal?.nodeId).toBe(`task-${storedRowId(5)}`);
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
    expect(runGesture).toHaveBeenCalledTimes(1);

    const info = setup(infoNode);
    await act(async () => { await info.result.current.onInfoSave({ body: "New body", details: "trace", isPrivate: false }); });
    expect(info.result.current.editorModal).toBeNull();
    expect(updateInfo).toHaveBeenCalledWith(storedRowId(3), { body: "New body", details: "trace", is_private: false });

    const tag = setup(tagNode);
    await act(async () => { await tag.result.current.onSimpleSave("Renamed tag", false, undefined); });
    expect(tag.result.current.editorModal).toBeNull();
    expect(updateDomain).toHaveBeenCalledWith(storedRowId(4), { title: "Renamed tag", is_private: false });
  });
});
