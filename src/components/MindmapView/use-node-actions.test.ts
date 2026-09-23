import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNodeActions } from "./use-node-actions";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { CLIPBOARD_OP } from "@/stores/use-clipboard-store";

vi.mock("@/api/tasks", () => ({
  updateTask: vi.fn().mockResolvedValue({ id: 1, status: "in_progress" }),
  TASK_STATUS: { TODO: "todo", IN_PROGRESS: "in_progress", DONE: "done" },
  // Read through `cameOutOfBacklog`: starting a set-aside task clears its Backlog, and the row
  // the backend sends back is what says whether it did.
  TASK_ARCHIVAL: { LIVE: "live", BACKLOG: "backlog" },
  // Read through `storedAgenticState`, which onCreateSibling uses to seed the new sibling.
  TASK_AGENTIC: { INHERIT: "inherit", YES: "yes", NO: "no" },
}));

vi.mock("@/api/goals", () => ({
  updateGoal: vi.fn().mockResolvedValue({ id: 2, status: "achieved" }),
}));

vi.mock("@/api/flows", () => ({
  setHabitItemStatus: vi.fn().mockResolvedValue(undefined),
  // The completion guard reads a rejection for the unfinished children it names; a resolved write
  // never reaches it, so every case here answers "not that refusal".
  unfinishedChildren: vi.fn(() => null),
  setHabitInstanceArchived: vi.fn().mockResolvedValue(undefined),
}));

// The stub renders the key and every interpolation value it was given, so a test can pin *which*
// kinds a refusal named — not merely that some refusal fired. A count-only call still reads
// `key:count`, exactly as it did when count was the only thing a refusal had to say.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts === undefined ? key : [key, ...Object.values(opts).map((value) => String(value))].join(":"),
  }),
}));

import { updateTask } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { setHabitInstanceArchived, setHabitItemStatus } from "@/api/flows";
import { fixtureRowId } from "@/test/node-fixture";

function mkNode(id: string, kind: NodeKind, children: MindmapNode[] = [], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children, ...extra };
}

const TASK_NODE = mkNode("task-5", "task", [], { status: "todo" });
const TASK_DONE = mkNode("task-6", "task", [], { status: "done" });
const GOAL_NODE = mkNode("goal-2", "goal", [], { status: "active" });
const GOAL_ACHIEVED = mkNode("goal-8", "goal", [], { status: "achieved" });
const ASPECT = mkNode("aspect-1", "aspect");
const HABIT_ITER = mkNode("habit-3-0-virtual", "task", [], {
  status: "todo", virtual: true, habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100, cycleId: 0 },
});
const HABIT_DONE = mkNode("habit-3-1-virtual", "task", [], {
  status: "done", virtual: true, habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 101, cycleId: 0 },
});
const HABIT_ITEM = mkNode("habititem-flow_task-4-0-virtual", "task", [], {
  status: "todo", virtual: true, habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100, cycleId: 0 },
});
const HABIT_GOAL_DONE = mkNode("habititem-flow_goal-9-0-virtual", "goal", [], {
  status: "achieved", virtual: true, habitItem: { flowId: 3, itemType: "flow_goal", itemId: 9, scopeId: 100, cycleId: 0 },
});
const HABIT_TASK_IP = mkNode("habititem-flow_task-7-0-virtual", "task", [], {
  status: "in_progress", virtual: true, habitItem: { flowId: 3, itemType: "flow_task", itemId: 7, scopeId: 100, cycleId: 0 },
});
// A task that answered the Agentic question itself, and one that only reads as agentic because an
// ancestor does — the pair that tells "copy the stored column" apart from "copy what it resolves to".
const TASK_AGENTIC_YES = mkNode("task-10", "task", [], { status: "todo", agentic: true });
const TASK_AGENTIC_NO = mkNode("task-11", "task", [], { status: "todo", agentic: false });
const TASK_INHERITS_YES = mkNode("task-12", "task", [], { status: "todo", agentic: null, inheritedAgentic: true });
const COMMITMENT_NODE = mkNode("commitment-7", "commitment", [], { verdict: "kept" });
const FLOW_TASK_NODE = mkNode("flowtask-4", "flow_task");
const FLOW_NODE = mkNode("flow-1", "flow", [FLOW_TASK_NODE]);
const FLOW_NODE_2 = mkNode("flow-2", "flow", []);
// A folded run of passed Habit iterations: `habit_group` is a tally and a span drawn in place of
// many nodes, with no row of its own. Its kind is the one the drop rule used to fall through on.
const HABIT_RUN = mkNode("habitgroup-3-run", "habit_group", [], {
  virtual: true,
  habitGroup: {
    flowId: 3, level: "run", passed: 3, done: 2, missed: 1,
    spanStart: "2026-09-14", spanEnd: "2026-09-16", spanLabel: "2026-09-14..2026-09-16",
  },
});
const PROJECT = mkNode("domain-3", "project", [TASK_NODE, TASK_DONE, GOAL_NODE, GOAL_ACHIEVED, ASPECT, HABIT_ITER, HABIT_DONE, HABIT_ITEM, HABIT_GOAL_DONE, HABIT_TASK_IP, TASK_AGENTIC_YES, TASK_AGENTIC_NO, TASK_INHERITS_YES, COMMITMENT_NODE, FLOW_NODE, FLOW_NODE_2]);
const ROOT = mkNode("root", "domain", [PROJECT]);

function makeOpts(overrides: Partial<Parameters<typeof useNodeActions>[0]> = {}) {
  return {
    tree: ROOT,
    clipboard: null,
    moveNode: vi.fn().mockResolvedValue(undefined),
    duplicateNode: vi.fn().mockResolvedValue(undefined),
    onRequestDelete: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    renameNode: vi.fn().mockResolvedValue(undefined),
    createNode: vi.fn().mockResolvedValue(mkNode("domain-99", "domain")),
    createChild: vi.fn().mockResolvedValue(mkNode("domain-99", "domain")),
    selectNode: vi.fn(),
    setClipboard: vi.fn(),
    setEditingNodeId: vi.fn(),
    showToast: vi.fn(),
    onNewFlow: vi.fn(),
    onNewCommitment: vi.fn(),
    ...overrides,
  };
}

/**
 * What the stubbed `t` makes of a destination refusal: the frame, the count, the kind refused
 * (carrying its own count, which is what gives it a plural), the destination it was dropped on,
 * and the parents the drop rule does allow. Spelling it out here keeps the expectations readable
 * while still pinning every one of those parts.
 */
function refusedHere(child: NodeKind, parent: NodeKind, count: number, parents: readonly NodeKind[]): string {
  return [
    "pasteSkippedHere",
    String(count),
    `nodeKinds:${child}:${count}`,
    `nodeKinds:${parent}`,
    parents.map((kind) => `nodeKinds:${kind}`).join(", "),
  ].join(":");
}

describe("useNodeActions — onStatusClick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTask).mockResolvedValue({ id: 5, title: "task-5", parent_type: "project", parent_id: 3, status: "in_progress", delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null, archival: "live", tag_ids: [], position: 0, is_private: false });
  });

  it("cycles todo → in_progress for a task node", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-5"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { status: "in_progress" }));
  });

  it("cycles done → todo for a task node", async () => {
    vi.mocked(updateTask).mockResolvedValue({ id: 6, title: "task-6", parent_type: "project", parent_id: 3, status: "todo", delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null, archival: "live", tag_ids: [], position: 0, is_private: false });
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-6"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(6, { status: "todo" }));
  });

  it("names the backlog the write cleared when a set-aside task is started", async () => {
    // Starting something you had put down takes it out of the backlog — one write, one undo step.
    // The toast comes from the row the backend sent back, never from predicting the rule here.
    const backlogged = mkNode("task-13", "task", [], { status: "todo", backlogged: true });
    const opts = makeOpts({ tree: mkNode("root", "domain", [mkNode("domain-3", "project", [backlogged])]) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-13"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(13, { status: "in_progress" }));
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-13", message: "warnings:backlogClearedByStart",
    }));
  });

  it("says nothing about the backlog when the task was never in it", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-5"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { status: "in_progress" }));
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("does not call updateTask for a non-task node", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("goal-2"); });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("toggles a real active goal to achieved on status click", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("goal-2"); });
    await vi.waitFor(() => expect(updateGoal).toHaveBeenCalledWith(2, { status: "achieved" }));
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("toggles a real achieved goal back to active on status click", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("goal-8"); });
    await vi.waitFor(() => expect(updateGoal).toHaveBeenCalledWith(8, { status: "active" }));
  });

  it("advances a todo task-instance root to in_progress (not straight to done)", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habit-3-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 100, 0, "in_progress", expect.any(Number), undefined),
    );
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("cycles a done task-instance root back to todo by clearing its status", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habit-3-1-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 101, 0, null, expect.any(Number), undefined),
    );
  });

  it("advances an in_progress task instance to done", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_task-7-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_task", 7, 100, 0, "done", expect.any(Number), undefined),
    );
  });

  it("un-achieves a completed goal instance by clearing its status", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_goal-9-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_goal", 9, 100, 0, null, expect.any(Number), undefined),
    );
  });

  it("advances a single todo task instance without touching the rest of the iteration", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_task-4-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_task", 4, 100, 0, "in_progress", expect.any(Number), undefined),
    );
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("useNodeActions — onStatusClick failures", () => {
  it("says so when the backend refuses a task's status cycle", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(updateTask).mockRejectedValueOnce(new Error("database is locked"));
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-5"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("statusChangeFailed"),
    }));
    consoleError.mockRestore();
  });

  it("says so when the backend refuses a goal's toggle", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(updateGoal).mockRejectedValueOnce(new Error("database is locked"));
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("goal-2"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "goal-2",
      message: expect.stringContaining("statusChangeFailed"),
    }));
    consoleError.mockRestore();
  });
});

describe("useNodeActions — onCommitEdit", () => {
  it("says so when the backend refuses the rename, and leaves the editor open", async () => {
    // A refused rename used to leave the old title on the canvas with nothing said — which reads
    // exactly like a rename that worked and was undone.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const opts = makeOpts({ renameNode: vi.fn().mockRejectedValue(new Error("aspects are fixed")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCommitEdit("task-5", "New title"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("renameFailed"),
    }));
    expect(opts.setEditingNodeId).not.toHaveBeenCalledWith(null);
    consoleError.mockRestore();
  });

  it("calls setEditingNodeId(null) for an empty title without renaming", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCommitEdit("task-5", "   "); });
    expect(opts.setEditingNodeId).toHaveBeenCalledWith(null);
    expect(opts.renameNode).not.toHaveBeenCalled();
  });

  it("calls renameNode with the trimmed title for a non-empty edit", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCommitEdit("task-5", "  My task  "); });
    await vi.waitFor(() => expect(opts.renameNode).toHaveBeenCalledWith("task-5", "task", "My task"));
  });
});

describe("useNodeActions — onCreateChild", () => {
  it("skips creation for a tag-kind node", () => {
    const tagNode = mkNode("domain-10", "tag");
    const tree = mkNode("root", "domain", [tagNode]);
    const opts = makeOpts({ tree });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateChild("domain-10"); });
    expect(opts.createChild).not.toHaveBeenCalled();
  });

  it("says why a Tag holds nothing, instead of being an inert key", () => {
    const TREE = mkNode("root", "domain", [mkNode("domain-3", "project", [mkNode("domain-20", "tag")])]);
    const opts = makeOpts({ tree: TREE });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateChild("domain-20"); });
    expect(opts.createChild).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "domain-20",
      message: expect.stringContaining("createUnderTagRefused"),
    });
  });

  it("says why a folded run of Habit history holds nothing", () => {
    const TREE = mkNode("root", "domain", [mkNode("domain-3", "project", [HABIT_RUN])]);
    const opts = makeOpts({ tree: TREE });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateChild("habitgroup-3-run"); });
    expect(opts.createChild).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habitgroup-3-run",
      message: expect.stringContaining("createUnderRepetition"),
    });
  });

  it("says so when the backend refuses the child", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const opts = makeOpts({ createChild: vi.fn().mockRejectedValue(new Error("tags cannot have child domains")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateChild("domain-3"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "domain-3",
      message: expect.stringContaining("createFailed"),
    }));
    consoleError.mockRestore();
  });

  it("creates a child and sets selection and editing state", async () => {
    const newNode = mkNode("domain-99", "domain");
    const opts = makeOpts({ createChild: vi.fn().mockResolvedValue(newNode) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateChild("domain-3"); });
    await vi.waitFor(() => expect(opts.createChild).toHaveBeenCalledWith("domain-3", "project", ""));
    expect(opts.selectNode).toHaveBeenCalledWith("domain-99");
    expect(opts.setEditingNodeId).toHaveBeenCalledWith("domain-99");
  });
});

describe("useNodeActions — onDelete", () => {
  it("refuses the whole selection out loud when one of its nodes is an Aspect", () => {
    // It used to filter the Aspect out and delete the rest without a word. A delete is destructive
    // where a paste is additive, so it refuses the gesture entirely — the repetition precedent.
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["task-5", "aspect-1"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "aspect-1",
      message: expect.stringContaining("deleteAspectRefused"),
    });
  });

  it("says why Delete on an Aspect alone does nothing, instead of being an inert key", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["aspect-1"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "aspect-1",
      message: expect.stringContaining("deleteAspectRefused"),
    });
  });

  it("says both reasons in one toast when a selection holds a repetition and an Aspect", () => {
    // The store holds a single pending notice, so a selection tripping both rules has to say both
    // at once or say one of them into nothing.
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["habit-3-0-virtual", "aspect-1", "task-5"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    const calls = vi.mocked(opts.showToast).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0].message).toContain("deleteRepetitionRefused");
    expect(calls[0]?.[0].message).toContain("deleteAspectRefused");
  });

  it("does not call onRequestDelete when every id has left the tree", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["task-404"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
  });

  it("refuses a virtual Habit repetition out loud instead of raising the confirmation", () => {
    // The repetition has no row behind it, so the confirmation used to open on a delete that could
    // only throw: `rowIdOf` refuses a node with no `rowId`, and the throw surfaced as a generic
    // "delete failed" inside the dialog. It never gets that far now — and it says the same thing
    // the List View says, since one gesture on one kind of node must not have two wordings.
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["habit-3-0-virtual"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habit-3-0-virtual",
      message: expect.stringContaining("deleteRepetitionRefused"),
    });
  });

  it("deletes a per-item Habit occurrence from its iteration alone, never raising the row delete", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["habititem-flow_task-4-0-virtual"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(setHabitInstanceArchived).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: "flow_task", itemId: 4 }), true,
    ));
    await waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habititem-flow_task-4-0-virtual",
      message: expect.stringContaining("occurrenceDeleted"),
    }));
  });

  it("refuses the whole selection when a repetition is in it, deleting none of the real nodes", () => {
    // Not the paste rule of dropping what it cannot take and naming the count: a delete is
    // destructive where a paste is additive, and the notice would be raised underneath the
    // confirmation overlay and fade unread.
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["task-5", "habit-3-0-virtual", "goal-2"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habit-3-0-virtual",
      message: expect.stringContaining("deleteRepetitionRefused"),
    });
  });

  it("says nothing and deletes normally when the selection is all real nodes", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["task-5", "goal-2"]); });
    expect(opts.onRequestDelete).toHaveBeenCalledWith(["task-5", "goal-2"]);
    expect(opts.showToast).not.toHaveBeenCalled();
  });
});

describe("useNodeActions — onPaste", () => {
  it("says so rather than failing quietly when a COPY of a Commitment is skipped", async () => {
    // There is no duplicate command for a Commitment — what a copy of a recorded Verdict means is
    // an open question — so the paste drops it. It is named, not swallowed.
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["commitment-7"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    expect(opts.showToast).toHaveBeenCalledWith({ nodeId: "goal-2", message: expect.any(String) });
    expect(opts.duplicateNode).not.toHaveBeenCalled();
  });

  it("a CUT of a Commitment still moves it — only copying has no command", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["commitment-7"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(opts.moveNode).toHaveBeenCalledWith("commitment-7", "commitment", "goal-2", "goal", 0),
    );
  });

  it("says so when the backend refuses the paste, instead of leaving an unchanged board", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({
      clipboard,
      moveNode: vi.fn().mockRejectedValue({ kind: "invalid_request", message: "would create a cycle" }),
    });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "goal-2",
      message: expect.stringContaining("pasteFailed"),
    }));
    // The backend's own reason travels with it — a paste refused for a cycle and one refused for a
    // constraint must not read the same.
    const calls = vi.mocked(opts.showToast).mock.calls;
    expect(calls[calls.length - 1]?.[0].message).toContain("would create a cycle");
    consoleError.mockRestore();
  });

  it("a backend refusal replaces a skip notice only by containing it", async () => {
    // Both come from one gesture and the store holds one pending toast, so the later message
    // carries the earlier one rather than taking it off screen unsaid.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["commitment-7", "task-5"] };
    const opts = makeOpts({
      clipboard,
      duplicateNode: vi.fn().mockRejectedValue(new Error("UNIQUE constraint failed")),
    });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(vi.mocked(opts.showToast).mock.calls.length).toBe(2));
    const [skip, both] = vi.mocked(opts.showToast).mock.calls;
    expect(skip?.[0].message).toContain("pasteSkippedCommitment");
    expect(both?.[0].message).toContain("pasteSkippedCommitment");
    expect(both?.[0].message).toContain("pasteFailed");
    consoleError.mockRestore();
  });

  it("refuses a paste onto a folded run of Habit history, once, rather than per clipboard node", () => {
    const TREE = mkNode("root", "domain", [mkNode("domain-3", "project", [TASK_NODE, GOAL_NODE, HABIT_RUN])]);
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5", "goal-2"] };
    const opts = makeOpts({ tree: TREE, clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("habitgroup-3-run"); });
    expect(opts.moveNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(opts.showToast).mock.calls[0]?.[0].message)
      .toContain("pasteOntoRepetitionRefused");
  });

  it("refuses a paste onto a virtual Habit occurrence, which cannot adopt an existing row", () => {
    // An occurrence holds children of its own, but they are *attached* when they are created. A
    // move only re-points a row's parent link, and there is no id here for one to point at.
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("habit-3-0-virtual"); });
    expect(opts.moveNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habit-3-0-virtual",
      message: expect.stringContaining("pasteOntoRepetitionRefused"),
    });
  });

  it("does nothing when clipboard is null", () => {
    const opts = makeOpts({ clipboard: null });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("domain-3"); });
    expect(opts.moveNode).not.toHaveBeenCalled();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
  });

  it("CUT moves clipboard nodes as children of the target", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(opts.moveNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0),
    );
    expect(opts.duplicateNode).not.toHaveBeenCalled();
  });

  it("clears clipboard after a CUT paste", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.setClipboard).toHaveBeenCalledWith(null));
  });

  it("COPY duplicates clipboard nodes as children of the target, and does not move them", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(opts.duplicateNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0),
    );
    expect(opts.moveNode).not.toHaveBeenCalled();
  });

  it("does not clear clipboard after a COPY paste", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.duplicateNode).toHaveBeenCalled());
    expect(opts.setClipboard).not.toHaveBeenCalled();
  });

  it("does not paste an aspect node — aspects cannot be reparented", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["aspect-1"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.moveNode).not.toHaveBeenCalled();
  });

  it("pastes valid nodes alongside an aspect, skipping only the aspect, and toasts the skip", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["aspect-1", "task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.duplicateNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0));
    expect(opts.duplicateNode).toHaveBeenCalledTimes(1);
    expect(opts.showToast).toHaveBeenCalledWith({ nodeId: "goal-2", message: "pasteSkippedAspect:1" });
  });

  it("does not paste a virtual (habit-instance) node", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["habit-3-0-virtual"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({ nodeId: "goal-2", message: "pasteSkippedRepetition:1" });
  });

  // One toast per reason, and every reason its own sentence: "couldn't be pasted here" used to
  // cover all of them, sending the user to hunt for a different parent when the parent was fine.
  it("says the destination is wrong only when the destination really is wrong", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["domain-3"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "goal-2",
      message: refusedHere("project", "goal", 1, ["aspect", "project"]),
    });
  });

  // The headline case: "1 node couldn't be pasted here" named neither the Goal nor the rule about
  // Task parents, so the only thing it told the user to do was guess.
  it("names the Goal, the Task it was dropped on, and where a Goal does go", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["goal-2"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("task-5"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: refusedHere("goal", "task", 1, ["aspect", "domain", "project", "goal"]),
    });
  });

  // Two kinds refused by one destination are two different rules. Counting them together — "2
  // nodes couldn't be pasted here" — would state a rule that is true of neither.
  it("gives each refused kind its own sentence when one destination refuses two", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["goal-2", "domain-3"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("task-5"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: [
        refusedHere("project", "task", 1, ["aspect", "project"]),
        refusedHere("goal", "task", 1, ["aspect", "domain", "project", "goal"]),
      ].join(" "),
    });
  });

  // Listing a flow item's legal parents would read "Flow, Goal, Task" — the labels real nodes use
  // — and so claim a Task cannot sit under a Task, which is false everywhere else in the app.
  it("sends a flow item dropped on a real node back inside its Flow", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["flowtask-4"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("task-5"); });
    await Promise.resolve();
    expect(opts.moveNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: [
        "pasteSkippedHereInFlow", "1", "nodeKinds:flow_task:1", "nodeKinds:task",
        "nodeKinds:flow, nodeKinds:flow_goal, nodeKinds:flow_task",
      ].join(":"),
    });
  });

  it("names the Commitment, not the destination, when a copied Commitment is refused", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["commitment-7"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({ nodeId: "goal-2", message: "pasteSkippedCommitment:1" });
  });

  it("says the copied node is gone when its id has left the tree", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["task-404"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.duplicateNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({ nodeId: "goal-2", message: "pasteSkippedGone:1" });
  });

  // A second showToast would overwrite the first, so a mixed selection has to arrive as one message
  // — and it still pastes the nodes that were legal.
  it("reports both reasons in one toast when a selection hits two, and pastes the rest", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["aspect-1", "commitment-7", "task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.duplicateNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0));
    expect(opts.duplicateNode).toHaveBeenCalledTimes(1);
    expect(opts.showToast).toHaveBeenCalledTimes(1);
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "goal-2",
      message: "pasteSkippedAspect:1 pasteSkippedCommitment:1",
    });
  });

  it("copies a flow item back into its own template", async () => {
    const opts = makeOpts({ clipboard: { operation: CLIPBOARD_OP.COPY, nodeIds: ["flowtask-4"] } });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("flow-1"); });
    await vi.waitFor(() =>
      expect(opts.duplicateNode).toHaveBeenCalledWith("flowtask-4", "flow_task", "flow-1", "flow", 1),
    );
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("refuses a flow item copied into a DIFFERENT flow, but CUT still moves it", async () => {
    const copyOpts = makeOpts({ clipboard: { operation: CLIPBOARD_OP.COPY, nodeIds: ["flowtask-4"] } });
    const { result: copyResult } = renderHook(() => useNodeActions(copyOpts));
    act(() => { copyResult.current.onPaste("flow-2"); });
    await Promise.resolve();
    // Its Cycle Scope is an offset into flow-1's window, which flow-2's window does not share.
    expect(copyOpts.duplicateNode).not.toHaveBeenCalled();
    expect(copyOpts.showToast).toHaveBeenCalledWith({ nodeId: "flow-2", message: "pasteSkippedOtherFlow:1" });

    const cutOpts = makeOpts({ clipboard: { operation: CLIPBOARD_OP.CUT, nodeIds: ["flowtask-4"] } });
    const { result: cutResult } = renderHook(() => useNodeActions(cutOpts));
    act(() => { cutResult.current.onPaste("flow-2"); });
    await vi.waitFor(() =>
      expect(cutOpts.moveNode).toHaveBeenCalledWith("flowtask-4", "flow_task", "flow-2", "flow", 0),
    );
  });

  it("copies a whole Flow onto any parent a Flow may hang from", async () => {
    const flow = mkNode("flow-5", "flow");
    const tree = mkNode("root", "domain", [mkNode("domain-5", "project", [flow]), mkNode("goal-2", "goal")]);
    const copyOpts = makeOpts({ tree, clipboard: { operation: CLIPBOARD_OP.COPY, nodeIds: ["flow-5"] } });
    const { result: copyResult } = renderHook(() => useNodeActions(copyOpts));
    act(() => { copyResult.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(copyOpts.duplicateNode).toHaveBeenCalledWith("flow-5", "flow", "goal-2", "goal", 0),
    );
    expect(copyOpts.showToast).not.toHaveBeenCalled();

    const cutOpts = makeOpts({ tree, clipboard: { operation: CLIPBOARD_OP.CUT, nodeIds: ["flow-5"] } });
    const { result: cutResult } = renderHook(() => useNodeActions(cutOpts));
    act(() => { cutResult.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(cutOpts.moveNode).toHaveBeenCalledWith("flow-5", "flow", "goal-2", "goal", 0),
    );
  });

  // A flow and a domain can share a database id, so a paste that moves "flow-5" must name the
  // flow — by id and by kind — and must move nothing else.
  it("cuts and pastes a flow as the flow, moving no other node", async () => {
    const flow = mkNode("flow-5", "flow");
    const target = mkNode("goal-2", "goal");
    const tree = mkNode("root", "domain", [mkNode("domain-5", "project", [flow]), target]);
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["flow-5"] };
    const opts = makeOpts({ tree, clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.moveNode).toHaveBeenCalledWith("flow-5", "flow", "goal-2", "goal", 0));
    expect(opts.moveNode).toHaveBeenCalledTimes(1);
  });

  // The skip nothing in the selection hinted at. The backend's duplication walk does not descend
  // into a Flow, so a Habit hanging under a copied Goal was simply absent from the paste — no
  // count, no toast, a subtree quietly smaller than the one that was copied.
  describe("a Flow left behind under a copied node", () => {
    const habit = mkNode("flow-7", "flow", [], { title: "Morning pages" });
    const lift = mkNode("flow-8", "flow", [], { title: "Lift" });
    const carrier = mkNode("goal-6", "goal", [habit, mkNode("task-9", "task", [lift])]);
    const destination = mkNode("goal-2", "goal");
    const tree = mkNode("root", "domain", [mkNode("domain-5", "project", [carrier, destination])]);

    /** What the stubbed `t` makes of the sentence: the frame, the count, then the flows list. */
    function leftBehind(count: number, ...flows: string[]): string {
      return ["pasteSkippedFlowUnder", String(count), flows.join(", ")].join(":");
    }
    const named = (title: string) => `warnings:pasteSkippedFlowName:${title}`;

    it("names the Flows it could not carry, and still copies the node it could", async () => {
      const opts = makeOpts({ tree, clipboard: { operation: CLIPBOARD_OP.COPY, nodeIds: ["goal-6"] } });
      const { result } = renderHook(() => useNodeActions(opts));
      act(() => { result.current.onPaste("goal-2"); });
      await vi.waitFor(() =>
        expect(opts.duplicateNode).toHaveBeenCalledWith("goal-6", "goal", "goal-2", "goal", 0),
      );
      // One toast for two Flows, not one each: the store holds a single pending notice.
      expect(opts.showToast).toHaveBeenCalledTimes(1);
      expect(opts.showToast).toHaveBeenCalledWith({
        nodeId: "goal-2",
        message: leftBehind(2, named("Morning pages"), named("Lift")),
      });
    });

    // A cut re-points one parent link and the whole subtree follows, Flows included.
    it("says nothing when the same subtree is cut, because nothing is left behind", async () => {
      const opts = makeOpts({ tree, clipboard: { operation: CLIPBOARD_OP.CUT, nodeIds: ["goal-6"] } });
      const { result } = renderHook(() => useNodeActions(opts));
      act(() => { result.current.onPaste("goal-2"); });
      await vi.waitFor(() => expect(opts.moveNode).toHaveBeenCalledTimes(1));
      expect(opts.showToast).not.toHaveBeenCalled();
    });

    // Composition: a destination refusal and a left-behind Flow arrive in the same message, or the
    // second showToast would take the first off screen unsaid.
    it("reports it alongside a refusal the same paste tripped", async () => {
      const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["goal-6", "aspect-1"] };
      const opts = makeOpts({ tree: mkNode("root", "domain", [
        mkNode("domain-5", "project", [carrier, destination, mkNode("aspect-1", "aspect")]),
      ]), clipboard });
      const { result } = renderHook(() => useNodeActions(opts));
      act(() => { result.current.onPaste("goal-2"); });
      await vi.waitFor(() =>
        expect(opts.duplicateNode).toHaveBeenCalledWith("goal-6", "goal", "goal-2", "goal", 0),
      );
      expect(opts.showToast).toHaveBeenCalledTimes(1);
      expect(opts.showToast).toHaveBeenCalledWith({
        nodeId: "goal-2",
        message: `pasteSkippedAspect:1 ${leftBehind(2, named("Morning pages"), named("Lift"))}`,
      });
    });
  });
});

describe("useNodeActions — onInsertParent", () => {
  it("says why nothing can be inserted above an Aspect, instead of being an inert key", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onInsertParent("aspect-1"); });
    expect(opts.createChild).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "aspect-1",
      message: expect.stringContaining("insertParentAspectRefused"),
    });
  });

  it("says so when the backend refuses one of its two writes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const opts = makeOpts({ createChild: vi.fn().mockRejectedValue(new Error("no such parent")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onInsertParent("task-5"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("insertParentFailed"),
    }));
    consoleError.mockRestore();
  });

  it("does nothing when the node's parent is root", () => {
    const opts = makeOpts({ tree: mkNode("root", "domain", [TASK_NODE]) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onInsertParent("task-5"); });
    expect(opts.createChild).not.toHaveBeenCalled();
  });

  it("creates a child of the parent, then moves the node under it", async () => {
    const intermediary = mkNode("domain-99", "project");
    const opts = makeOpts({
      createChild: vi.fn().mockResolvedValue(intermediary),
    });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onInsertParent("task-5"); });
    await vi.waitFor(() => expect(opts.setEditingNodeId).toHaveBeenCalledWith("domain-99"));
    expect(opts.createChild).toHaveBeenCalledWith("domain-3", "project", "");
    expect(opts.moveNode).toHaveBeenCalledWith("task-5", "task", "domain-99", "project", 0);
    expect(opts.selectNode).toHaveBeenCalledWith("domain-99");
  });
});

describe("useNodeActions — onCreateSibling", () => {
  it("says why there is no new Aspect to create alongside this one", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("aspect-1"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "aspect-1",
      message: expect.stringContaining("siblingAspectRefused"),
    });
  });

  it("says so when the backend refuses the sibling", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const opts = makeOpts({ createNode: vi.fn().mockRejectedValue(new Error("CHECK constraint failed")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-5"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("createFailed"),
    }));
    consoleError.mockRestore();
  });

  it("creates a sibling of the same kind under the same parent", async () => {
    const newNode = mkNode("task-99", "task");
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(newNode) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-5"); });
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "task", "", "inherit"),
    );
    expect(opts.selectNode).toHaveBeenCalledWith("task-99");
  });

  it("carries the source task's own Agentic flag onto the sibling", async () => {
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(mkNode("task-99", "task")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-10"); });
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "task", "", "yes"),
    );
  });

  it("carries an explicit Not agentic over too — it is an answer, not an absence", async () => {
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(mkNode("task-99", "task")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-11"); });
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "task", "", "no"),
    );
  });

  it("copies the stored flag, not the resolved one: a source that merely inherits yes stays unset", async () => {
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(mkNode("task-99", "task")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-12"); });
    // "inherit", never "yes" — freezing the inherited value here would cut the sibling off from
    // the ancestor deciding for it, and the ordinary downward rule already gives it that yes.
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "task", "", "inherit"),
    );
  });

  it("sends no Agentic seed for a kind that has no such flag", async () => {
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(mkNode("goal-99", "goal")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("goal-2"); });
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "goal", "", undefined),
    );
  });
});

describe("useNodeActions — onCreateTypedChild", () => {
  const TAG = mkNode("domain-20", "tag");
  const DOMAIN = mkNode("domain-21", "domain");
  const INFO = mkNode("info-1", "info");
  // A Habit whose instances are Goals draws its iteration root as a `goal`. That is what made
  // Shift+F on one pass a kind-only check: a Flow may sit under a Goal.
  const GOAL_OCCURRENCE = mkNode("habit-3-0-virtual", "goal", [], {
    virtual: true, habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100, cycleId: 0 },
  });
  const CONTAINER = mkNode("domain-3", "project", [TASK_NODE, GOAL_NODE, COMMITMENT_NODE, TAG, DOMAIN, INFO, FLOW_NODE, GOAL_OCCURRENCE, HABIT_RUN]);
  const TREE = mkNode("root", "domain", [CONTAINER]);

  function typedOpts(overrides: Partial<Parameters<typeof useNodeActions>[0]> = {}) {
    return makeOpts({ tree: TREE, ...overrides });
  }

  it("creates a Goal under a Project and puts the new node straight into rename", async () => {
    const opts = typedOpts({ createNode: vi.fn().mockResolvedValue(mkNode("goal-99", "goal")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-3", "goal"); });
    await vi.waitFor(() => expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "goal", ""));
    expect(opts.selectNode).toHaveBeenCalledWith("goal-99");
    expect(opts.setEditingNodeId).toHaveBeenCalledWith("goal-99");
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("creates a Task under a Commitment", async () => {
    const opts = typedOpts({ createNode: vi.fn().mockResolvedValue(mkNode("task-99", "task")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("commitment-7", "task"); });
    await vi.waitFor(() => expect(opts.createNode).toHaveBeenCalledWith("commitment-7", "commitment", "task", ""));
  });

  it("creates an Info under a Task", async () => {
    const opts = typedOpts({ createNode: vi.fn().mockResolvedValue(mkNode("info-99", "info")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-5", "info"); });
    await vi.waitFor(() => expect(opts.createNode).toHaveBeenCalledWith("task-5", "task", "info", ""));
  });

  it("refuses a Goal under a Task with a toast naming the rule, and creates nothing", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-5", "goal"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("typedChildRefused"),
    });
  });

  it("refuses a Flow under a Task — a Flow hangs from an Aspect, Domain, Project or Goal", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-5", "flow"); });
    expect(opts.onNewFlow).not.toHaveBeenCalled();
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("refuses a Domain under a Task", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-5", "domain"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("refuses a Project under a Domain — a Project needs an Aspect or a Project", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-21", "project"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("creates an Info under a Tag — the one kind a label holds", async () => {
    const opts = typedOpts({ createNode: vi.fn().mockResolvedValue(mkNode("info-99", "info")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-20", "info"); });
    await vi.waitFor(() => expect(opts.createNode).toHaveBeenCalledWith("domain-20", "tag", "info", ""));
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("refuses every other kind under a Tag", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-20", "task"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("refuses a real node under a Flow, whose children are its own items", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("flow-1", "task"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("opens the Flow editor rather than creating a blank Flow row", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-3", "flow"); });
    expect(opts.onNewFlow).toHaveBeenCalledWith("domain-3");
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  // Shift+C used to post a bare commitment with no Time Scope, which the backend refuses when
  // nothing above the parent is scoped — a chord whose only outcome was a refusal toast. It now
  // opens the editor, where the window can be set before anything is written.
  it("opens the Commitment editor rather than creating a windowless Commitment row", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-3", "commitment"); });
    expect(opts.onNewCommitment).toHaveBeenCalledWith("domain-3");
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  // The parent check still runs first: the editor is not opened on a parent that could never hold
  // a commitment, because the refusal is about placement, not about the window.
  it("refuses a Commitment under a Tag without opening the editor", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("domain-20", "commitment"); });
    expect(opts.onNewCommitment).not.toHaveBeenCalled();
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledTimes(1);
  });

  it("says so when the backend refuses the creation, instead of failing where nobody is looking", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const opts = typedOpts({ createNode: vi.fn().mockRejectedValue(new Error("CHECK constraint failed")) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-5", "info"); });
    await vi.waitFor(() => expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "task-5",
      message: expect.stringContaining("createFailed"),
    }));
    expect(opts.selectNode).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does nothing for a node that is not in the tree", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("task-404", "task"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("does nothing on the synthetic root, which has no row behind it", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("root", "domain"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  // Shift+F used to reach the Flow editor on a virtual occurrence and post a parent id of `NaN`,
  // because the rule was asked about the occurrence's *kind* — `goal`, which does hold Flows.
  it("refuses a Flow on a virtual Habit occurrence instead of opening the editor on a NaN parent", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("habit-3-0-virtual", "flow"); });
    expect(opts.onNewFlow).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habit-3-0-virtual",
      message: expect.stringContaining("createUnderOccurrenceRefused"),
    });
  });

  // The other half of the same rule: an occurrence does hold children of its own, so the four
  // kinds its attachment path can write are not refused with it.
  it("still opens the Commitment editor on a virtual Habit occurrence", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("habit-3-0-virtual", "commitment"); });
    expect(opts.onNewCommitment).toHaveBeenCalledWith("habit-3-0-virtual");
    expect(opts.showToast).not.toHaveBeenCalled();
  });

  it("refuses a Task on a folded run of Habit history, which is drawn rather than stored", () => {
    const opts = typedOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateTypedChild("habitgroup-3-run", "task"); });
    expect(opts.createNode).not.toHaveBeenCalled();
    expect(opts.showToast).toHaveBeenCalledWith({
      nodeId: "habitgroup-3-run",
      message: expect.stringContaining("createUnderRepetition"),
    });
  });
});
