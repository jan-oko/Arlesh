import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeActions } from "./use-node-actions";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";

vi.mock("@/api/tasks", () => ({
  updateTask: vi.fn().mockResolvedValue({ id: 1, status: "in_progress" }),
  TASK_STATUS: { TODO: "todo", IN_PROGRESS: "in_progress", DONE: "done" },
}));

import { updateTask } from "@/api/tasks";

function mkNode(id: string, kind: NodeKind, children: MindmapNode[] = [], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

const TASK_NODE = mkNode("task-5", "task", [], { status: "todo" });
const TASK_DONE = mkNode("task-6", "task", [], { status: "done" });
const GOAL_NODE = mkNode("goal-2", "goal");
const ASPECT = mkNode("aspect-1", "aspect");
const PROJECT = mkNode("domain-3", "project", [TASK_NODE, TASK_DONE, GOAL_NODE, ASPECT]);
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
    vi.mocked(updateTask).mockResolvedValue({ id: 5, title: "task-5", parent_type: "project", parent_id: 3, status: "in_progress", blocked_reason: null, delegate_to: null, time_scope: null, plan_scope_id: null, tag_ids: [], position: 0 });
  });

  it("cycles todo → in_progress for a task node", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useNodeActions(opts));
    act(() => { result.current.onStatusClick("task-5"); });
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { status: "in_progress" }));
  });

  it("cycles done → todo for a task node", async () => {
    vi.mocked(updateTask).mockResolvedValue({ id: 6, title: "task-6", parent_type: "project", parent_id: 3, status: "todo", blocked_reason: null, delegate_to: null, time_scope: null, plan_scope_id: null, tag_ids: [], position: 0 });
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
