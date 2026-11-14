import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSearchStart } from "./use-search-start";
import { updateTask } from "@/api/tasks";
import type { Task } from "@/api/tasks";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { fixtureRowId } from "@/test/node-fixture";
import { patchedFields } from "@/test/lane-helpers";
import { agentic, ordinary } from "@/utils/status-mapping";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: { title?: string }) => `${key}|${vars?.title ?? ""}` }),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function treeOf(...children: MindmapNode[]): MindmapNode {
  return node("root", { kind: "domain", children });
}

function toast() { return useMindmapStore.getState().pendingToast; }

function press(tree: MindmapNode, id: string) {
  const { result } = renderHook(() => useSearchStart(tree));
  act(() => { result.current(id); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateTask).mockReturnValue(new Promise<Task>(() => undefined));
  usePendingWritesStore.getState().reset();
  useMindmapStore.setState({ pendingToast: null });
  usePendingWritesStore.getState().reportBoard({ read: 0, epoch: null, seq: null, revision: null, at: 0 });
});

describe("useSearchStart", () => {
  it("sets an ordinary Task In Progress through the status write, and names it", () => {
    press(treeOf(node("task-5", { title: "Write docs", taskStatus: ordinary("done") })), "task-5");
    expect(patchedFields()).toEqual([{ status: "in_progress", taskStatus: ordinary("in_progress") }]);
    expect(updateTask).toHaveBeenCalledWith(5, { status: ordinary("in_progress") });
    expect(toast()).toEqual({ nodeId: "task-5", message: "startedInProgress|Write docs" });
  });

  it("sets an Agentic Task Doing", () => {
    press(treeOf(node("task-5", { title: "Ship", taskStatus: agentic("todo") })), "task-5");
    expect(updateTask).toHaveBeenCalledWith(5, { status: agentic("doing") });
    expect(toast()?.message).toBe("startedDoing|Ship");
  });

  it("writes nothing for a Task already there, but still says so", () => {
    press(treeOf(node("task-5", { taskStatus: ordinary("in_progress") })), "task-5");
    expect(updateTask).not.toHaveBeenCalled();
    expect(toast()?.message).toContain("startedInProgress");
  });

  it.each([
    ["a Compound Task", node("task-5", { taskStatus: ordinary("todo"), compound: true }), "compoundStatusRefused"],
    ["a blocked Task", node("task-5", { taskStatus: ordinary("todo"), blockReasons: ["x"] }), "startBlocked"],
    ["a Goal", node("task-5", { kind: "goal" }), "startNotATask"],
  ])("refuses %s with a toast and writes nothing", (_name, row, key) => {
    press(treeOf(row), "task-5");
    expect(updateTask).not.toHaveBeenCalled();
    expect(patchedFields()).toEqual([]);
    expect(toast()?.message.startsWith(key)).toBe(true);
  });
});
