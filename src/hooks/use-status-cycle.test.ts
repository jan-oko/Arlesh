import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStatusCycle } from "./use-status-cycle";
import { stepTaskStatus } from "@/api/node-gestures";
import type { StatusStepOutcome } from "@/api/node-gestures";
import { updateGoal } from "@/api/goals";
import { updateTask } from "@/api/tasks";
import type { Task } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { agentic, ordinary } from "@/utils/status-mapping";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import type { ModeStatus } from "@/api/client-mode";
import { storedRowId } from "@/test/stored-id";

// What a press writes is decided by the backend (`tasks::rules::gestures`); these pin what the hook
// does with it: which call it makes, and what it says when the answer is a refusal.
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  stepTaskStatus: vi.fn(),
}));
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
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
    id: storedRowId(id), title: `task-${id}`, parent_type: "aspect", parent_id: storedRowId(1), status,
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
  useClientModeStore.setState({ status: null });
});

describe("useStatusCycle: a press is one awaited call", () => {
  it("sends one step of the cycle for the row", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written(IN_PROGRESS));
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(5), "advance"));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("sends Alt+Enter as the alt step", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written(IN_PROGRESS));
    const { result } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.toggleStarted(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(5), "alt"));
  });

  it("asks the backend for an Agentic Task's step too: the model is the backend's to know", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written(IN_PROGRESS));
    const { result } = setup([node(`task-${storedRowId(5)}`, { status: "review", taskStatus: agentic("review") })]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(5), "advance"));
  });

  it("sets a Task to the status it is told, sent as an edit", async () => {
    vi.mocked(updateTask).mockResolvedValue(IN_PROGRESS);
    const { result } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.setTaskStatus(`task-${storedRowId(5)}`, ordinary("in_progress")); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(storedRowId(5), { status: ordinary("in_progress") }));
  });

  it("says so when setting a status takes a Backlogged Task out of the Backlog", async () => {
    vi.mocked(updateTask).mockResolvedValue({ ...IN_PROGRESS, archival: "live" });
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`, { backlogged: true })]);

    act(() => { result.current.setTaskStatus(`task-${storedRowId(5)}`, ordinary("in_progress")); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ nodeId: `task-${storedRowId(5)}`, message: "warnings:backlogClearedByStart" }));
  });

  it("says nothing about the Backlog for a Task that was not in it", async () => {
    vi.mocked(updateTask).mockResolvedValue(IN_PROGRESS);
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.setTaskStatus(`task-${storedRowId(5)}`, ordinary("in_progress")); });

    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
  });

  it("leaves a node that is not a Task alone", () => {
    const { result } = setup([node(`goal-${storedRowId(2)}`, { kind: "goal", status: "active" })]);
    act(() => { result.current.setTaskStatus(`goal-${storedRowId(2)}`, ordinary("in_progress")); });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("toggles a Goal between active and achieved", async () => {
    vi.mocked(updateGoal).mockResolvedValue(Object.create(null));
    const { result } = setup([node(`goal-${storedRowId(2)}`, { kind: "goal", status: "active" })]);

    act(() => { result.current.cycleStatus(`goal-${storedRowId(2)}`); });

    await waitFor(() => expect(updateGoal).toHaveBeenCalledWith(storedRowId(2), { status: "achieved" }));
  });
});

describe("useStatusCycle: refusals", () => {
  it("says why the backend refused a press on a Compound Task, and writes nothing", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue({ outcome: "refused", reason: "compound" });
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`, { compound: true })]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ nodeId: `task-${storedRowId(5)}`, message: "warnings:compoundStatusRefused" }));
  });

  it("says why when the backend refuses Alt+Enter on Agentic work that is not Doing", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue({ outcome: "refused", reason: "alt_enter_agentic_not_doing" });
    const { result, showToast } = setup([node(`task-${storedRowId(5)}`, { status: "todo", taskStatus: agentic("todo") })]);

    act(() => { result.current.toggleStarted(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ nodeId: `task-${storedRowId(5)}`, message: "warnings:altEnterAgenticNotDoing" }));
  });

  it("says why when the backend refuses Done over open sub-items", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue({ outcome: "refused", reason: "open_sub_items" });
    const { result, showToast } = setup([node(`task-${storedRowId(5)}`, { status: "in_progress", taskStatus: ordinary("in_progress") })]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ nodeId: `task-${storedRowId(5)}`, message: "warnings:openSubItemsRefused" }));
  });

  it("says so when the write is rejected", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue({ kind: "database", message: "db is locked" });
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: `task-${storedRowId(5)}` })));
  });

  it("refuses on a read-only board with a notice and no call", () => {
    useClientModeStore.setState({ status: readOnly() });
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`)]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: `task-${storedRowId(5)}` }));
  });

  it("says when the write took the task out of the Backlog", async () => {
    vi.mocked(stepTaskStatus).mockResolvedValue(written(task(5, { kind: "ordinary", status: "started" }), "by_started"));
    const { result, showToast } = setup([todo(`task-${storedRowId(5)}`, { backlogged: true })]);

    act(() => { result.current.toggleStarted(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: `task-${storedRowId(5)}` })));
  });
});

describe("useStatusCycle: the occurrence guard", () => {
  const MILK = [{ child_type: "task", child_id: storedRowId(12), title: "buy milk" }];
  const HOLDING = { kind: "needs_confirmation", message: "still holds work", details: { children: MILK } };
  const occurrence = () => node(`task-${storedRowId(5)}`, { status: "in_progress", taskStatus: ordinary("in_progress") });

  it("opens the prompt without a toast when the backend holds the press for unfinished children", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue(HOLDING);
    const { result, showToast } = setup([occurrence()]);

    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });

    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.occurrencePrompt?.children).toEqual(MILK);
  });

  it("sends it again confirmed on Confirm", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValueOnce(HOLDING).mockResolvedValue(written(task(5, { kind: "ordinary", status: "done" })));
    const { result } = setup([occurrence()]);
    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });
    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());

    act(() => { result.current.confirmOccurrence(); });

    expect(result.current.occurrencePrompt).toBeNull();
    await waitFor(() => expect(stepTaskStatus).toHaveBeenLastCalledWith(storedRowId(5), "advance", true));
  });

  it("declining sends nothing more", async () => {
    vi.mocked(stepTaskStatus).mockRejectedValue(HOLDING);
    const { result } = setup([occurrence()]);
    act(() => { result.current.cycleStatus(`task-${storedRowId(5)}`); });
    await waitFor(() => expect(result.current.occurrencePrompt).not.toBeNull());

    act(() => { result.current.cancelOccurrence(); });

    expect(result.current.occurrencePrompt).toBeNull();
    expect(stepTaskStatus).toHaveBeenCalledTimes(1);
  });
});

describe("useStatusCycle: what is left alone", () => {
  it("leaves a node that is not a task to its own gesture", () => {
    const { result } = setup([node(`commitment-${storedRowId(5)}`, { kind: "commitment" })]);

    act(() => { result.current.toggleStarted(`commitment-${storedRowId(5)}`); });

    expect(stepTaskStatus).not.toHaveBeenCalled();
  });
});
