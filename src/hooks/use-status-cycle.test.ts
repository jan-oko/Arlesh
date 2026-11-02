import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStatusCycle } from "./use-status-cycle";
import { stepTaskStatus } from "@/api/node-gestures";
import type { StatusStepOutcome } from "@/api/node-gestures";
import { updateGoal } from "@/api/goals";
import type { Goal } from "@/api/goals";
import type { Task } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { deferred, lane, patchedFields } from "@/test/lane-helpers";
import { agentic, ordinary } from "@/utils/status-mapping";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { ModeStatus } from "@/api/client-mode";

// What a press writes is predicted by `utils/task-gestures.ts` (pinned by the corpus) and decided
// by the backend; these pin what the hook does with it: what the board shows at once, what it
// sends and in which order, and what it says when the answer is a refusal.
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  stepTaskStatus: vi.fn(),
}));
vi.mock("@/api/goals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/goals")>()),
  updateGoal: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function todo(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return node(id, { status: "todo", taskStatus: ordinary("todo"), ...extra });
}

function setup(nodes: MindmapNode[]) {
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() => useStatusCycle({ findNode: (id) => byId.get(id), showToast }));
  return { ...rendered, showToast, byId };
}

function task(id: number, status: Task["status"]): Task {
  return {
    id, title: `task-${id}`, parent_type: "aspect", parent_id: 1, status,
    delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null,
    plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
  };
}

/** A written outcome carrying the row the server left. */
function written(row: Task, backlogCleared: "by_start" | "by_started" | null = null): StatusStepOutcome {
  return { outcome: "written", task: row, backlog_cleared: backlogCleared };
}

const IN_PROGRESS = task(5, { kind: "ordinary", status: "in_progress" });

function readOnly(): ModeStatus {
  return {
    mode: "client", first_run: false, api_version: 1, standalone_available: false,
    server: { url: "http://server", reachable: false, last_sync: null, read_only: "server_unreachable", server_api_version: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingWritesStore.getState().reset();
  useClientModeStore.setState({ status: null });
  // A board drawn before any write, so an answered write stays until a newer one arrives.
  usePendingWritesStore.getState().reportBoard("test", { read: 0, epoch: null, revision: null });
});

describe("useStatusCycle: a press is shown at once and sent through the lane", () => {
  it("patches the node before the write resolves, then sends one step of the cycle", async () => {
    const held = deferred<StatusStepOutcome>();
    vi.mocked(stepTaskStatus).mockReturnValue(held.promise);
    const { result } = setup([todo("task-5")]);

    act(() => { result.current.cycleStatus("task-5"); });

    expect(patchedFields()).toEqual([{ status: "in_progress", taskStatus: ordinary("in_progress") }]);
    expect(stepTaskStatus).toHaveBeenCalledWith(5, "advance");

    await act(async () => { held.resolve(written(IN_PROGRESS)); await held.promise; });
    expect(lane()[0]?.state).toBe("answered");
    expect(lane()[0]?.answer?.fields).toEqual({ status: "in_progress", taskStatus: ordinary("in_progress") });
  });

  it("sends Alt+Enter as the alt step and shows Started", () => {
    vi.mocked(stepTaskStatus).mockReturnValue(new Promise(() => undefined));
    const { result } = setup([todo("task-5")]);

    act(() => { result.current.toggleStarted("task-5"); });

    expect(patchedFields()).toEqual([{ status: "started", taskStatus: ordinary("started") }]);
    expect(stepTaskStatus).toHaveBeenCalledWith(5, "alt");
  });

  it("shows two quick presses as two steps and sends them in order", async () => {
    const first = deferred<StatusStepOutcome>();
    const second = deferred<StatusStepOutcome>();
    vi.mocked(stepTaskStatus).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, byId } = setup([todo("task-5")]);

    act(() => { result.current.cycleStatus("task-5"); });
    // The board has shown the first press, so the second predicts from it.
    byId.set("task-5", todo("task-5", { status: "in_progress", taskStatus: ordinary("in_progress") }));
    act(() => { result.current.cycleStatus("task-5"); });

    expect(patchedFields()).toEqual([
      { status: "in_progress", taskStatus: ordinary("in_progress") },
      { status: "done", taskStatus: ordinary("done") },
    ]);
    expect(stepTaskStatus).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(written(IN_PROGRESS)); await first.promise; });
    expect(stepTaskStatus).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(written(task(5, { kind: "ordinary", status: "done" }))); await second.promise; });
    expect(lane().every((write) => write.state === "answered")).toBe(true);
  });

  it("takes the Agentic cycle for an Agentic Task", () => {
    vi.mocked(stepTaskStatus).mockReturnValue(new Promise(() => undefined));
    const { result } = setup([node("task-5", { status: "review", taskStatus: agentic("review") })]);

    act(() => { result.current.cycleStatus("task-5"); });

    expect(patchedFields()).toEqual([{ status: "doing", taskStatus: agentic("doing") }]);
  });

  it("toggles a Goal between active and achieved through the lane", () => {
    vi.mocked(updateGoal).mockReturnValue(new Promise(() => undefined));
    const { result } = setup([node("goal-2", { kind: "goal", status: "active" })]);

    act(() => { result.current.cycleStatus("goal-2"); });

    expect(patchedFields()).toEqual([{ status: "achieved" }]);
    expect(updateGoal).toHaveBeenCalledWith(2, { status: "achieved" });
  });

  it("shows the returned Goal row's status once the server has answered", async () => {
    const goal: Goal = {
      id: 2, title: "g", parent_type: "aspect", parent_id: 1, status: "achieved", time_scope: null, on_scope_exit: null,
    } as Goal;
    vi.mocked(updateGoal).mockResolvedValue(goal);
    const { result } = setup([node("goal-2", { kind: "goal", status: "active" })]);

    act(() => { result.current.cycleStatus("goal-2"); });

    await waitFor(() => expect(lane()[0]?.answer?.fields).toEqual({ status: "achieved" }));
  });
});

describe("useStatusCycle: refusals", () => {
  it("writes nothing for a Compound Task and shows the existing toast", () => {
    const { result, showToast } = setup([todo("task-5", { compound: true })]);

    act(() => { result.current.cycleStatus("task-5"); });

    expect(lane()).toEqual([]);
    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("writes nothing for Alt+Enter on Agentic work that is not Doing", () => {
    const { result, showToast } = setup([node("task-5", { status: "todo", taskStatus: agentic("todo") })]);

    act(() => { result.current.toggleStarted("task-5"); });

    expect(lane()).toEqual([]);
    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("rolls back a refused step and the presses after it on the node, but not another node's", async () => {
    const first = deferred<StatusStepOutcome>();
    vi.mocked(stepTaskStatus).mockReturnValueOnce(first.promise).mockReturnValue(new Promise(() => undefined));
    const { result, showToast, byId } = setup([todo("task-5"), todo("task-6")]);

    act(() => { result.current.cycleStatus("task-5"); });
    byId.set("task-5", todo("task-5", { status: "in_progress", taskStatus: ordinary("in_progress") }));
    act(() => { result.current.cycleStatus("task-5"); });
    act(() => { result.current.cycleStatus("task-6"); });
    expect(lane()).toHaveLength(3);

    await act(async () => {
      first.resolve({ outcome: "refused", reason: "compound" });
      await first.promise;
    });

    expect(lane().map((write) => write.nodeId)).toEqual(["task-6"]);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("rolls back and says why when the write is rejected", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue({ kind: "database", message: "db is locked" });
    const { result, showToast } = setup([todo("task-5")]);

    act(() => { result.current.cycleStatus("task-5"); });

    await waitFor(() => expect(lane()).toEqual([]));
    expect(showToast).toHaveBeenCalledWith({ nodeId: "task-5", message: "db is locked" });
  });

  it("refuses on a read-only board with a notice and no patch", () => {
    useClientModeStore.setState({ status: readOnly() });
    const { result, showToast } = setup([todo("task-5")]);

    act(() => { result.current.cycleStatus("task-5"); });

    expect(lane()).toEqual([]);
    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("says when the write took the task out of the Backlog", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written(task(5, { kind: "ordinary", status: "started" }), "by_started"));
    const { result, showToast } = setup([todo("task-5", { backlogged: true })]);

    act(() => { result.current.toggleStarted("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" })));
  });
});

describe("useStatusCycle: the occurrence guard", () => {
  const MILK = [{ child_type: "task", child_id: 12, title: "buy milk" }];
  const HOLDING = { kind: "needs_confirmation", message: "still holds work", details: { children: MILK } };
  const occurrence = () => node("task-5", { status: "in_progress", taskStatus: ordinary("in_progress") });

  it("rolls the press back without a toast and opens the prompt", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue(HOLDING);
    const { result, showToast } = setup([occurrence()]);

    act(() => { result.current.cycleStatus("task-5"); });
    expect(patchedFields()).toEqual([{ status: "done", taskStatus: ordinary("done") }]);

    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());
    expect(lane()).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.occurrencePrompt?.children).toEqual(MILK);
  });

  it("shows Done again on Confirm and sends it confirmed", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValueOnce(HOLDING).mockReturnValue(new Promise(() => undefined));
    const { result } = setup([occurrence()]);
    act(() => { result.current.cycleStatus("task-5"); });
    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());

    act(() => { result.current.confirmOccurrence(); });

    expect(result.current.occurrencePrompt).toBeNull();
    expect(patchedFields()).toEqual([{ status: "done", taskStatus: ordinary("done") }]);
    expect(stepTaskStatus).toHaveBeenLastCalledWith(5, "advance", true);
  });

  it("declining leaves the occurrence as it was and sends nothing more", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue(HOLDING);
    const { result } = setup([occurrence()]);
    act(() => { result.current.cycleStatus("task-5"); });
    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());

    act(() => { result.current.cancelOccurrence(); });

    expect(result.current.occurrencePrompt).toBeNull();
    expect(lane()).toEqual([]);
    expect(stepTaskStatus).toHaveBeenCalledTimes(1);
  });
});

describe("useStatusCycle: what is left alone", () => {
  it("leaves a node that is not a task to its own gesture", () => {
    const { result } = setup([node("commitment-5", { kind: "commitment" })]);

    act(() => { result.current.toggleStarted("commitment-5"); });

    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(lane()).toEqual([]);
  });
});
