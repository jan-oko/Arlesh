import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useOpenAsyncTemplate } from "@/hooks/use-open-async-template";
import { useMindmapStore } from "@/stores/use-mindmap-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function node(id: string, kind: MindmapNode["kind"], over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...over };
}

describe("useOpenAsyncTemplate — Shift+W", () => {
  beforeEach(() => useMindmapStore.getState().clearToast());

  it("opens a Task's editor at its Expectation section, writing nothing", () => {
    const task = node("task-5", "task", { rowId: 5 });
    const setEditorModal = vi.fn();
    const { result } = renderHook(() => useOpenAsyncTemplate(node("root", "domain", { children: [task] }), setEditorModal));
    act(() => result.current("task-5"));
    expect(setEditorModal).toHaveBeenCalledWith({ nodeId: "task-5", node: task, focus: "asyncTemplate" });
  });

  it("refuses anything but a real Task, out loud", () => {
    const setEditorModal = vi.fn();
    const tree = node("root", "domain", { children: [node("goal-2", "goal", { rowId: 2 })] });
    const { result } = renderHook(() => useOpenAsyncTemplate(tree, setEditorModal));
    act(() => result.current("goal-2"));
    expect(setEditorModal).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("bindNotATask");
  });
});
