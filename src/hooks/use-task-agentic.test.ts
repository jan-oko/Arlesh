import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskAgentic } from "./use-task-agentic";
import { toggleTaskAgentic } from "@/api/node-gestures";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

// Which flag a press writes is the backend's (`tasks::rules::gestures::toggled_agentic`); these pin
// which nodes the key acts on, and that a failure is said out loud.
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  toggleTaskAgentic: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() =>
    useTaskAgentic({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useTaskAgentic", () => {
  it("sends the press for the task's own row and reloads", async () => {
    vi.mocked(toggleTaskAgentic).mockResolvedValue(Object.create(null));
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(toggleTaskAgentic).toHaveBeenCalledWith(5));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("declines every node that has no agentic column of its own", () => {
    const { result } = setup([node("goal-1", { kind: "goal" })]);

    act(() => {
      result.current.toggleAgentic("goal-1");
      result.current.toggleAgentic("task-missing");
    });

    expect(toggleTaskAgentic).not.toHaveBeenCalled();
  });

  it("flags a Habit occurrence on its own row, since it is a Task like any other", async () => {
    const occurrence = node("task-4", { ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }) });
    vi.mocked(toggleTaskAgentic).mockResolvedValue(Object.create(null));
    const { result } = setup([occurrence]);

    act(() => { result.current.toggleAgentic("task-4"); });

    await waitFor(() => expect(toggleTaskAgentic).toHaveBeenCalledWith(occurrence.rowId));
  });

  it("says so when the write fails rather than leaving the flag silently unchanged", async () => {
    vi.mocked(toggleTaskAgentic).mockRejectedValue(new Error("db is gone"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "task-5" }),
    ));
  });
});
