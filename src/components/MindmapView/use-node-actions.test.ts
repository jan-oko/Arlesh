import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeActions } from "./use-node-actions";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";

vi.mock("@/api/tasks", () => ({
  updateTask: vi.fn().mockResolvedValue({ id: 1, status: "in_progress" }),
  TASK_STATUS: { TODO: "todo", IN_PROGRESS: "in_progress", DONE: "done" },
}));

vi.mock("@/api/goals", () => ({
  updateGoal: vi.fn().mockResolvedValue({ id: 2, status: "achieved" }),
}));

vi.mock("@/api/flows", () => ({
  setHabitItemStatus: vi.fn().mockResolvedValue(undefined),
}));

import { updateTask } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { setHabitItemStatus } from "@/api/flows";

function mkNode(id: string, kind: NodeKind, children: MindmapNode[] = [], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

const TASK_NODE = mkNode("task-5", "task", [], { status: "todo" });
const TASK_DONE = mkNode("task-6", "task", [], { status: "done" });
const GOAL_NODE = mkNode("goal-2", "goal", [], { status: "active" });
const GOAL_ACHIEVED = mkNode("goal-8", "goal", [], { status: "achieved" });
const ASPECT = mkNode("aspect-1", "aspect");
const HABIT_ITER = mkNode("habit-3-0-virtual", "task", [], {
  status: "todo", virtual: true, habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100 },
});
const HABIT_DONE = mkNode("habit-3-1-virtual", "task", [], {
  status: "done", virtual: true, habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 101 },
});
const HABIT_ITEM = mkNode("habititem-flow_task-4-0-virtual", "task", [], {
  status: "todo", virtual: true, habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100 },
});
const HABIT_GOAL_DONE = mkNode("habititem-flow_goal-9-0-virtual", "goal", [], {
  status: "achieved", virtual: true, habitItem: { flowId: 3, itemType: "flow_goal", itemId: 9, scopeId: 100 },
});
const HABIT_TASK_IP = mkNode("habititem-flow_task-7-0-virtual", "task", [], {
  status: "in_progress", virtual: true, habitItem: { flowId: 3, itemType: "flow_task", itemId: 7, scopeId: 100 },
});
const PROJECT = mkNode("domain-3", "project", [TASK_NODE, TASK_DONE, GOAL_NODE, GOAL_ACHIEVED, ASPECT, HABIT_ITER, HABIT_DONE, HABIT_ITEM, HABIT_GOAL_DONE, HABIT_TASK_IP]);
const ROOT = mkNode("root", "domain", [PROJECT]);

function makeOpts(overrides: Partial<Parameters<typeof useNodeActions>[0]> = {}) {
  return {
    tree: ROOT,
    clipboard: null,
    moveNode: vi.fn().mockResolvedValue(undefined),
    onRequestDelete: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    renameNode: vi.fn().mockResolvedValue(undefined),
    createNode: vi.fn().mockResolvedValue(mkNode("domain-99", "domain")),
    createChild: vi.fn().mockResolvedValue(mkNode("domain-99", "domain")),
    selectNode: vi.fn(),
    setClipboard: vi.fn(),
    setEditingNodeId: vi.fn(),
    ...overrides,
  };
}

describe("useNodeActions — onStatusClick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTask).mockResolvedValue({ id: 5, title: "task-5", parent_type: "project", parent_id: 3, status: "in_progress", delegate_to: null, time_scope: null, on_scope_exit: null, plan: null, tag_ids: [], position: 0, is_private: false });
  });

  it("cycles todo → in_progress for a task node", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-5"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { status: "in_progress" }));
  });

  it("cycles done → todo for a task node", async () => {
    vi.mocked(updateTask).mockResolvedValue({ id: 6, title: "task-6", parent_type: "project", parent_id: 3, status: "todo", delegate_to: null, time_scope: null, on_scope_exit: null, plan: null, tag_ids: [], position: 0, is_private: false });
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-6"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(6, { status: "todo" }));
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
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 100, "in_progress", expect.any(Number)),
    );
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("cycles a done task-instance root back to todo by clearing its status", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habit-3-1-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 101, null, expect.any(Number)),
    );
  });

  it("advances an in_progress task instance to done", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_task-7-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_task", 7, 100, "done", expect.any(Number)),
    );
  });

  it("un-achieves a completed goal instance by clearing its status", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_goal-9-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_goal", 9, 100, null, expect.any(Number)),
    );
  });

  it("advances a single todo task instance without touching the rest of the iteration", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("habititem-flow_task-4-0-virtual"); });
    await vi.waitFor(() =>
      expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_task", 4, 100, "in_progress", expect.any(Number)),
    );
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("useNodeActions — onCommitEdit", () => {
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
  it("filters out aspect nodes and calls onRequestDelete with remaining IDs", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["task-5", "aspect-1"]); });
    expect(opts.onRequestDelete).toHaveBeenCalledWith(["task-5"]);
  });

  it("does not call onRequestDelete when all IDs are aspects or unknown", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onDelete(["aspect-1"]); });
    expect(opts.onRequestDelete).not.toHaveBeenCalled();
  });
});

describe("useNodeActions — onPaste", () => {
  it("does nothing when clipboard is null", () => {
    const opts = makeOpts({ clipboard: null });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("domain-3"); });
    expect(opts.moveNode).not.toHaveBeenCalled();
  });

  it("moves clipboard nodes as children of the target", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() =>
      expect(opts.moveNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0),
    );
  });

  it("clears clipboard after a CUT paste", async () => {
    const clipboard = { operation: CLIPBOARD_OP.CUT, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.setClipboard).toHaveBeenCalledWith(null));
  });

  it("does not clear clipboard after a COPY paste", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.moveNode).toHaveBeenCalled());
    expect(opts.setClipboard).not.toHaveBeenCalled();
  });

  it("does not move an aspect node — aspects cannot be reparented", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["aspect-1"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await Promise.resolve();
    expect(opts.moveNode).not.toHaveBeenCalled();
  });

  it("pastes valid nodes alongside an aspect, skipping only the aspect", async () => {
    const clipboard = { operation: CLIPBOARD_OP.COPY, nodeIds: ["aspect-1", "task-5"] };
    const opts = makeOpts({ clipboard });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onPaste("goal-2"); });
    await vi.waitFor(() => expect(opts.moveNode).toHaveBeenCalledWith("task-5", "task", "goal-2", "goal", 0));
    expect(opts.moveNode).toHaveBeenCalledTimes(1);
  });
});

describe("useNodeActions — onInsertParent", () => {
  it("does nothing for an aspect node", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onInsertParent("aspect-1"); });
    expect(opts.createChild).not.toHaveBeenCalled();
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
  it("does nothing for an aspect node", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("aspect-1"); });
    expect(opts.createNode).not.toHaveBeenCalled();
  });

  it("creates a sibling of the same kind under the same parent", async () => {
    const newNode = mkNode("task-99", "task");
    const opts = makeOpts({ createNode: vi.fn().mockResolvedValue(newNode) });
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onCreateSibling("task-5"); });
    await vi.waitFor(() =>
      expect(opts.createNode).toHaveBeenCalledWith("domain-3", "project", "task", ""),
    );
    expect(opts.selectNode).toHaveBeenCalledWith("task-99");
  });
});
