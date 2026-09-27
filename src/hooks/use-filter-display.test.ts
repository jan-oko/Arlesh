import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilterDisplay } from "./use-filter-display";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import type { MindmapNode } from "@/utils/tree-layout";
import { useDisplayStore } from "@/stores/use-display-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/MindmapView/use-mindmap-data");

const mockUseMindmapData = vi.mocked(useMindmapData);

function mindmapData(tree: MindmapNode) {
  return {
    tree, isLoading: false, error: null, loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    createNode: vi.fn(), createChild: vi.fn(), renameNode: vi.fn(),
    reorderNode: vi.fn(), moveNode: vi.fn(), duplicateNode: vi.fn(), removeNode: vi.fn(), createCommitment: vi.fn(), createFlow: vi.fn(),
    updateFlow: vi.fn(), reload: vi.fn(),
  };
}

const TREE: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [],
  children: [
    {
      id: "domain-1", rowId: 1, kind: "aspect", title: "Red", color: "#e74c3c", position: 0, tagIds: [],
      children: [
        { id: "domain-2", rowId: 2, kind: "tag", title: "urgent", color: "#e74c3c", position: 0, tagIds: [], children: [] },
        { id: "project-1", rowId: 1, kind: "project", title: "Rocket", color: "#e74c3c", position: 0, tagIds: [], children: [
          { id: "goal-1", rowId: 1, kind: "goal", title: "Launch", status: "active", color: "#e74c3c", position: 0, tagIds: [], children: [] },
          { id: "task-1", rowId: 1, kind: "task", title: "Fuel up", status: "todo", color: "#e74c3c", position: 0, tagIds: [], children: [] },
        ] },
      ],
    },
  ],
};

describe("useFilterDisplay", () => {
  it("resolves a tag's name and inherited aspect color", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.tagName(2)).toBe("urgent");
    expect(result.current.tagColor(2)).toBe("#e74c3c");
  });

  it("falls back to #<id> for an unknown tag", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.tagName(999)).toBe("#999");
  });

  it("resolves any tree node's label and color by ref, for parent/dependency chips", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.nodeLabel("project-1")).toBe("Rocket");
    expect(result.current.nodeColor("project-1")).toBe("#e74c3c");
    expect(result.current.nodeLabel("goal-1")).toBe("Launch");
  });

  it("falls back to the raw ref when the node is unknown", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.nodeLabel("task-999")).toBe("task-999");
    expect(result.current.nodeColor("task-999")).toBeNull();
  });

  it("builds the antecedent pool from Aspect/Domain/Project/Goal/Task kinds, excluding tags", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    const ids = result.current.antecedentPool.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["domain-1", "project-1", "goal-1", "task-1"]));
    expect(ids).not.toContain("domain-2"); // the tag
  });

  it("builds the dependency pool from Task/Goal kinds only", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    const ids = result.current.dependencyPool.map((o) => o.id);
    expect(ids).toEqual(["goal-1", "task-1"]);
  });

  it("resolves enum display labels through the status/listView namespaces", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.displayTaskStatus("todo")).toBe("status:task.todo");
    expect(result.current.displayGoalStatus("achieved")).toBe("status:goal.achieved");
    expect(result.current.displayProjectStatus("frozen")).toBe("status:project.frozen");
    expect(result.current.displayScopeState("overdue")).toBe("listView:scopeState.overdue");
    expect(result.current.displayBlocked("blocked")).toBe("listView:blockedState.blocked");
  });

  it("passes an unrecognized enum value straight through", () => {
    mockUseMindmapData.mockReturnValue(mindmapData(TREE));
    const { result } = renderHook(() => useFilterDisplay());
    expect(result.current.displayTaskStatus("bogus")).toBe("bogus");
  });

  describe("archived nodes in the Under / Depends on pools (Ctrl+F and the Filter menu)", () => {
    const ARCHIVED_TREE: MindmapNode = {
      id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [],
      children: [
        { id: "project-1", rowId: 1, kind: "project", title: "Live", position: 0, tagIds: [], children: [] },
        { id: "project-2", rowId: 2, kind: "project", title: "Shelved", status: "archived", position: 1, tagIds: [], children: [
          { id: "task-5", rowId: 5, kind: "task", title: "Inside", status: "todo", position: 0, tagIds: [], children: [] },
        ] },
        { id: "task-6", rowId: 6, kind: "task", title: "Lapsed", status: "todo", archived: true, position: 2, tagIds: [], children: [] },
      ],
    };

    it("leaves archived nodes out by default, but not the live nodes under them", () => {
      useDisplayStore.setState({ searchIncludesArchived: false });
      mockUseMindmapData.mockReturnValue(mindmapData(ARCHIVED_TREE));
      const { result } = renderHook(() => useFilterDisplay());
      expect(result.current.antecedentPool.map((o) => o.label)).toEqual(["Live", "Inside"]);
      expect(result.current.dependencyPool.map((o) => o.label)).toEqual(["Inside"]);
      expect(result.current.nodeLabel("task-5")).toBe("Inside");
    });

    it("offers them when the setting includes archived nodes", () => {
      useDisplayStore.setState({ searchIncludesArchived: true });
      mockUseMindmapData.mockReturnValue(mindmapData(ARCHIVED_TREE));
      const { result } = renderHook(() => useFilterDisplay());
      expect(result.current.antecedentPool.map((o) => o.label)).toEqual(["Live", "Shelved", "Inside", "Lapsed"]);
      expect(result.current.dependencyPool.map((o) => o.label)).toEqual(["Inside", "Lapsed"]);
      useDisplayStore.setState({ searchIncludesArchived: false });
    });
  });
});
