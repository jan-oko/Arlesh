import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStatusCycle } from "./use-status-cycle";
import { stepTaskStatus } from "@/api/node-gestures";
import type { StatusStepOutcome } from "@/api/node-gestures";
import type { Task } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

// What a press writes is the backend's (`tasks::rules::gestures`, unit-tested there); these pin
// what the hook does with the answer: which node it sends, and what it says and reloads.
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  stepTaskStatus: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() => useStatusCycle({ findNode: (id) => byId.get(id), reload, showToast }));
  return { ...rendered, reload, showToast };
}

/** A written outcome; the hook reads only whether the write cleared the Backlog. */
function written(backlogCleared: "by_start" | "by_started" | null = null): StatusStepOutcome {
  return { outcome: "written", task: TASK, backlog_cleared: backlogCleared };
}

const TASK: Task = {
  id: 5, title: "task-5", parent_type: "aspect", parent_id: 1,
  status: { kind: "ordinary", status: "in_progress" },
  delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null,
  plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
};

beforeEach(() => vi.clearAllMocks());

describe("useStatusCycle — the gestures the backend decides", () => {
  it("sends Enter as one step of the cycle and reloads", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written());
    const { result, reload } = setup([node("task-5", { status: "todo" })]);

    act(() => { result.current.cycleStatus("task-5"); });

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(stepTaskStatus).toHaveBeenCalledWith(5, "advance");
  });

  it("sends Alt+Enter as the alt step", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written());
    const { result } = setup([node("task-5", { status: "todo" })]);

    act(() => { result.current.toggleStarted("task-5"); });

    await waitFor(() => expect(stepTaskStatus).toHaveBeenCalledWith(5, "alt"));
  });

  it("says a refusal out loud and reloads nothing", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue({ outcome: "refused", reason: "compound" });
    const { result, showToast, reload } = setup([node("task-5", { compound: true, status: "in_progress" })]);

    act(() => { result.current.cycleStatus("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" })));
    expect(reload).not.toHaveBeenCalled();
  });

  it("says when the write took the task out of the Backlog", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written("by_started"));
    const { result, showToast, reload } = setup([node("task-5", { status: "todo", backlogged: true })]);

    act(() => { result.current.toggleStarted("task-5"); });

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("leaves a node that is not a task to its own gesture", () => {
    const { result } = setup([node("goal-5", { kind: "commitment" })]);

    act(() => { result.current.toggleStarted("goal-5"); });

    expect(stepTaskStatus).not.toHaveBeenCalled();
  });
});
