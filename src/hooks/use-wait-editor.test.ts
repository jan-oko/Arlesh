import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useWaitEditor } from "@/hooks/use-wait-editor";
import { useMindmapStore } from "@/stores/use-mindmap-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const createExpectation = vi.fn((_request: unknown) => Promise.resolve({ id: 42 }));
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  createExpectation: (request: unknown) => createExpectation(request),
  updateExpectation: vi.fn(() => Promise.resolve()),
  addTagToExpectation: vi.fn(() => Promise.resolve()),
}));
const updateTask = vi.fn((_id: number, _request: unknown) => Promise.resolve());
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: number, request: unknown) => updateTask(id, request),
}));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  withAtomicGesture: (_name: string, run: () => Promise<unknown>) => run(),
}));

function node(id: string, kind: MindmapNode["kind"], over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...over };
}

function board(task: MindmapNode): MindmapNode {
  return node("root", "domain", { children: [node("domain-1", "project", { rowId: 1, children: [task] })] });
}

const SAVE = {
  title: "Reply", status: "pending" as const, checkEvery: null, checkStartingDate: null, timeScope: null,
  tagIds: [], archived: false, isPrivate: false,
};
const TEMPLATE = { title: "Waiting on the reviewer", tag_ids: [], check_every: { n: 2, kind: "day" } };

describe("useWaitEditor — Shift+W", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMindmapStore.getState().clearToast();
  });

  it("opens a Task's template, and saving writes the template and creates no Expectation", async () => {
    const tree = board(node("task-5", "task", { rowId: 5, title: "Send it" }));
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useWaitEditor(tree, reload));
    act(() => result.current.bind("task-5"));
    expect(result.current.template).toEqual({ taskId: 5, taskTitle: "Send it", template: null });
    await act(() => result.current.saveTemplate("gesture", TEMPLATE));
    expect(updateTask).toHaveBeenCalledWith(5, { async_template: TEMPLATE });
    expect(createExpectation).not.toHaveBeenCalled();
    expect(result.current.template).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("opens the template a Task already has, and removing it makes the Task not asynchronous", async () => {
    const tree = board(node("task-5", "task", { rowId: 5, asynchronous: true, asyncTemplate: TEMPLATE }));
    const { result } = renderHook(() => useWaitEditor(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.bind("task-5"));
    expect(result.current.template?.template).toEqual(TEMPLATE);
    await act(() => result.current.saveTemplate("gesture", null));
    expect(updateTask).toHaveBeenCalledWith(5, { async_template: null });
  });

  it("refuses anything but a real Task, out loud", () => {
    const tree = board(node("goal-2", "goal", { rowId: 2 }));
    const { result } = renderHook(() => useWaitEditor(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.bind("goal-2"));
    expect(result.current.template).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("bindNotATask");
  });
});

describe("useWaitEditor — Shift+E", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a stored wait under a row, bound to nothing", async () => {
    const tree = board(node("task-5", "task", { rowId: 5 }));
    const { result } = renderHook(() => useWaitEditor(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.createUnder("task-5"));
    expect(result.current.create).toEqual({ parentType: "task", parentId: 5 });
    await act(() => result.current.saveCreate("gesture", {
      ...SAVE, checkEvery: { n: 1, kind: "week" }, checkStartingDate: "2026-10-01",
    }));
    expect(createExpectation).toHaveBeenCalledWith({
      title: "Reply", parent_type: "task", parent_id: 5,
      check_every: { n: 1, kind: "week" }, check_starting: "2026-10-01T00:00:00",
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(result.current.create).toBeNull();
  });
});
