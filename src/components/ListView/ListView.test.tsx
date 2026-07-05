import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ListView from "./ListView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useListData } from "@/hooks/use-list-data";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-list-data");
vi.mock("@/components/MindmapView/use-node-editor", () => ({
  useNodeEditor: () => ({
    editorModal: null,
    setEditorModal: vi.fn(),
    allTags: [],
    domainNames: new Map(),
    availableForDep: [],
    onDoubleClick: vi.fn(),
    onTaskSave: vi.fn(),
    checkScopeClamp: vi.fn(),
  }),
}));
vi.mock("@/components/TaskEditorModal/TaskEditorModal", () => ({ default: () => <div data-testid="editor-modal" /> }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    parentRef: "goal-1",
    ancestorRefs: ["aspect-1", "goal-1"],
    ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" })],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    hasBlockedAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

const mockUseListData = vi.mocked(useListData);

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  mockUseListData.mockReturnValue({
    tree: n("root", "domain"),
    rows: [row()],
    allTasksAndGoals: [],
    isLoading: false,
    error: null,
    reload: vi.fn(),
    onCycleStatus: vi.fn(),
  });
});

describe("ListView", () => {
  it("renders a task row", () => {
    render(<ListView />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    mockUseListData.mockReturnValue({
      tree: n("root", "domain"), rows: [], allTasksAndGoals: [], isLoading: true, error: null,
      reload: vi.fn(), onCycleStatus: vi.fn(),
    });
    render(<ListView />);
    expect(screen.getByText("common:loading")).toBeInTheDocument();
  });

  it("shows the empty state when no rows pass the filter", () => {
    mockUseListData.mockReturnValue({
      tree: n("root", "domain"), rows: [], allTasksAndGoals: [], isLoading: false, error: null,
      reload: vi.fn(), onCycleStatus: vi.fn(),
    });
    render(<ListView />);
    expect(screen.getByText("listView:empty")).toBeInTheDocument();
  });

  it("Plan/Start/Do preset clicks write through to the shared status mode", () => {
    render(<ListView />);
    fireEvent.click(screen.getByText("listView:preset.do"));
    expect(useFilterStore.getState().filter.statusMode).toBe("do");
    expect(useListFilterStore.getState().filter.preset).toBe("do");
  });

  it("Unblock preset does not change the shared status mode", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
    render(<ListView />);
    fireEvent.click(screen.getByText("listView:preset.unblock"));
    expect(useFilterStore.getState().filter.statusMode).toBe("plan");
    expect(useListFilterStore.getState().filter.preset).toBe("unblock");
  });

  it("shows a Goal header when the goal-headers toggle is on", () => {
    render(<ListView />);
    fireEvent.click(screen.getByText("listView:showGoalHeaders"));
    // "goal-1" now appears twice: the new group header, and the task row's parent label.
    expect(screen.getAllByText("goal-1")).toHaveLength(2);
  });

  it("clicking a task's parent label adds a parent filter pill", () => {
    render(<ListView />);
    fireEvent.click(screen.getByTitle("filterByParent"));
    expect(useListFilterStore.getState().filter.pills.parent).toEqual([{ value: "goal-1", mode: "any" }]);
  });

  it("clicking a task's tag pill adds a shared tag filter", () => {
    mockUseListData.mockReturnValue({
      tree: n("root", "domain"),
      rows: [row({ node: n("task-1", "task", { status: "todo", tagIds: [7] }) })],
      allTasksAndGoals: [], isLoading: false, error: null, reload: vi.fn(), onCycleStatus: vi.fn(),
    });
    render(<ListView />);
    fireEvent.click(screen.getByTitle("filterByTag"));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 7, mode: "any" }]);
  });
});
