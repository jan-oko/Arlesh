import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useAsyncExpectationOffer } from "@/hooks/use-async-expectation-offer";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { expectationNodeId } from "@/utils/node-uuid";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const createExpectation = vi.fn((_request: unknown) => Promise.resolve({ id: 42 }));
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  createExpectation: (request: unknown) => createExpectation(request),
  updateExpectation: vi.fn(() => Promise.resolve()),
  addTagToExpectation: vi.fn(() => Promise.resolve()),
}));
const updateTask = vi.fn((_id: number, _request: unknown) => Promise.resolve());
const addTaskDependency = vi.fn((_id: number, _dep: unknown) => Promise.resolve());
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: number, request: unknown) => updateTask(id, request),
  addTaskDependency: (id: number, dep: unknown) => addTaskDependency(id, dep),
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
  title: "Reply", status: "pending" as const, checkBy: null, timeScope: null, tagIds: [], archived: false, isPrivate: false,
};

describe("useAsyncExpectationOffer — Shift+W", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMindmapStore.getState().clearToast();
  });

  it("opens the editor for a Task, and saving marks it asynchronous and binds it, beside it", async () => {
    const tree = board(node("task-5", "task", { rowId: 5 }));
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAsyncExpectationOffer(tree, reload));
    act(() => result.current.bind("task-5"));
    expect(result.current.offer).toMatchObject({ reason: "bind", taskId: 5, parentType: "project", parentId: 1 });
    await act(() => result.current.save("gesture", SAVE));
    expect(createExpectation).toHaveBeenCalledWith({ title: "Reply", parent_type: "project", parent_id: 1 });
    expect(updateTask).toHaveBeenCalledWith(5, { asynchronous: true });
    expect(addTaskDependency).toHaveBeenCalledWith(5, { type: "expectation", id: 42 });
    expect(result.current.offer).toBeNull();
  });

  it("refuses a Task that already waits on something, naming the wait", () => {
    const wait = node(expectationNodeId(9), "expectation", { rowId: 9, title: "Reviewer replies" });
    const tree = board(node("task-5", "task", { rowId: 5, expectationDependencyIds: [9] }));
    tree.children[0]?.children.push(wait);
    const { result } = renderHook(() => useAsyncExpectationOffer(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.bind("task-5"));
    expect(result.current.offer).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("bindAlreadyWaits");
  });

  it("refuses anything but a Task", () => {
    const tree = board(node("goal-2", "goal", { rowId: 2 }));
    const { result } = renderHook(() => useAsyncExpectationOffer(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.bind("goal-2"));
    expect(result.current.offer).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("bindNotATask");
  });

  it("creates a plain wait under a row, bound to nothing", async () => {
    const tree = board(node("task-5", "task", { rowId: 5 }));
    const { result } = renderHook(() => useAsyncExpectationOffer(tree, vi.fn(() => Promise.resolve())));
    act(() => result.current.createUnder("task-5"));
    expect(result.current.offer).toMatchObject({ reason: "create", taskId: null, parentType: "task", parentId: 5 });
    await act(() => result.current.save("gesture", SAVE));
    expect(addTaskDependency).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});
