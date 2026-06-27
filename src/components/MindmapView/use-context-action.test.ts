import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContextAction } from "./use-context-action";
import { CONTEXT_ACTION } from "@/components/NodeContextMenu/context-action";
import type { MindmapNode } from "@/utils/tree-layout";

const stubNode: MindmapNode = {
  id: "domain-1",
  kind: "domain",
  title: "Test Domain",
  position: 0,
  tagIds: [],
  children: [],
};

function makeOpts(overrides: Partial<Parameters<typeof useContextAction>[0]> = {}) {
  return {
    findNodeById: vi.fn((_id: string) => stubNode as MindmapNode | undefined),
    enterSubtree: vi.fn(),
    setEditingNodeId: vi.fn(),
    cycleType: vi.fn(),
    setClipboard: vi.fn(),
    clipboard: null,
    onPaste: vi.fn(),
    toggleCollapsed: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("useContextAction", () => {
  it("does nothing when the node is not found", () => {
    const opts = makeOpts({ findNodeById: vi.fn(() => undefined) });
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("missing", CONTEXT_ACTION.ENTER);
    expect(opts.enterSubtree).not.toHaveBeenCalled();
  });

  it("ENTER calls enterSubtree with the node id", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.ENTER);
    expect(opts.enterSubtree).toHaveBeenCalledWith("domain-1");
  });

  it("RENAME calls setEditingNodeId with the node id", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.RENAME);
    expect(opts.setEditingNodeId).toHaveBeenCalledWith("domain-1");
  });

  it("TYPE_UP calls cycleType with direction +1", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.TYPE_UP);
    expect(opts.cycleType).toHaveBeenCalledWith("domain-1", 1);
  });

  it("TYPE_DOWN calls cycleType with direction -1", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.TYPE_DOWN);
    expect(opts.cycleType).toHaveBeenCalledWith("domain-1", -1);
  });

  it("CUT stores a cut clipboard entry", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.CUT);
    expect(opts.setClipboard).toHaveBeenCalledWith({ operation: "cut", nodeIds: ["domain-1"] });
  });

  it("COPY stores a copy clipboard entry", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.COPY);
    expect(opts.setClipboard).toHaveBeenCalledWith({ operation: "copy", nodeIds: ["domain-1"] });
  });

  it("PASTE calls onPaste when clipboard is set", () => {
    const opts = makeOpts({ clipboard: { operation: "cut", nodeIds: ["other"] } });
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.PASTE);
    expect(opts.onPaste).toHaveBeenCalledWith("domain-1");
  });

  it("PASTE does nothing when clipboard is null", () => {
    const opts = makeOpts({ clipboard: null });
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.PASTE);
    expect(opts.onPaste).not.toHaveBeenCalled();
  });

  it("COLLAPSE calls toggleCollapsed", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.COLLAPSE);
    expect(opts.toggleCollapsed).toHaveBeenCalledWith("domain-1");
  });

  it("EXPAND also calls toggleCollapsed (same underlying action)", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.EXPAND);
    expect(opts.toggleCollapsed).toHaveBeenCalledWith("domain-1");
  });

  it("DELETE calls onDelete with a singleton array", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useContextAction(opts));
    result.current.onContextAction("domain-1", CONTEXT_ACTION.DELETE);
    expect(opts.onDelete).toHaveBeenCalledWith(["domain-1"]);
  });
});
