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
    hasPrivateAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

function listData(overrides: Partial<ReturnType<typeof useListData>> = {}) {
  return {
    tree: n("root", "domain"),
    rows: [row()],
    allTasksAndGoals: [],
    isLoading: false,
    error: null,
    reload: vi.fn(),
    onCycleStatus: vi.fn(),
    renameNode: vi.fn(),
    ...overrides,
  };
}

const mockUseListData = vi.mocked(useListData);

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  mockUseListData.mockReturnValue(listData());
});

describe("ListView", () => {
  it("renders a task row", () => {
    render(<ListView />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    mockUseListData.mockReturnValue(listData({ rows: [], isLoading: true }));
    render(<ListView />);
    expect(screen.getByText("common:loading")).toBeInTheDocument();
  });

  it("shows the empty state when no rows pass the filter", () => {
    mockUseListData.mockReturnValue(listData({ rows: [] }));
    render(<ListView />);
    expect(screen.getByText("listView:empty")).toBeInTheDocument();
  });

  it("respects the Unblock preset when set externally (e.g. from the TopBar dropdown)", () => {
    useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "unblock" } });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({ node: n("task-open", "task", { status: "todo" }), isBlocked: false }),
        row({ node: n("task-blocked", "task", { status: "todo" }), isBlocked: true }),
      ],
    }));
    render(<ListView />);
    expect(screen.queryByText("task-open")).not.toBeInTheDocument();
    expect(screen.getByText("task-blocked")).toBeInTheDocument();
  });

  it("names a run's whole chain in a path header above it", () => {
    render(<ListView />);
    expect(screen.getByText("aspect-1")).toBeInTheDocument();
    // "goal-1" reads twice: the last path segment, and the task row's own parent label.
    expect(screen.getAllByText("goal-1")).toHaveLength(2);
  });

  it("renders no path header for a task with no ancestors", () => {
    mockUseListData.mockReturnValue(listData({
      rows: [row({ parentRef: "", ancestorRefs: [], ancestors: [], goalRef: null, goalStatus: null })],
    }));
    render(<ListView />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.queryByTitle("filterByAntecedent")).not.toBeInTheDocument();
  });

  it("names an ancestor task the active filter hides, so an orphaned subtask still reads in context", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    const parent = n("task-parent", "task", { status: "todo" });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({ node: parent }),
        row({
          node: n("task-child", "task", { status: "in_progress" }),
          parentRef: "task-parent",
          ancestorRefs: ["aspect-1", "goal-1", "task-parent"],
          ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" }), parent],
        }),
      ],
    }));
    render(<ListView />);
    // The Do preset filters the parent out as a row, so it moves into the header instead.
    expect(screen.getAllByTitle("filterByAntecedent").map((segment) => segment.textContent))
      .toEqual(["aspect-1", "goal-1", "task-parent"]);
  });

  it("clicking a path segment adds an antecedent filter pill", () => {
    render(<ListView />);
    const [aspectSegment] = screen.getAllByTitle("filterByAntecedent");
    if (aspectSegment === undefined) throw new Error("expected a path header segment");
    fireEvent.click(aspectSegment);
    expect(useListFilterStore.getState().filter.pills.antecedent).toEqual([{ value: "aspect-1", mode: "any" }]);
  });

  it("no longer offers a Goal-visibility toggle", () => {
    render(<ListView />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("clicking a task's parent label adds a parent filter pill", () => {
    render(<ListView />);
    fireEvent.click(screen.getByTitle("filterByParent"));
    expect(useListFilterStore.getState().filter.pills.parent).toEqual([{ value: "goal-1", mode: "any" }]);
  });

  it("clicking a task's tag pill adds a shared tag filter", () => {
    mockUseListData.mockReturnValue(listData({ rows: [row({ node: n("task-1", "task", { status: "todo", tagIds: [7] }) })] }));
    render(<ListView />);
    fireEvent.click(screen.getByTitle("filterByTag"));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 7, mode: "any" }]);
  });

  describe("keyboard navigation and actions", () => {
    function twoRows() {
      return listData({
        rows: [
          row({ node: n("task-a", "task", { status: "todo" }) }),
          row({ node: n("task-b", "task", { status: "todo" }) }),
        ],
      });
    }

    it("ArrowDown selects the first row when nothing is selected, then moves to the next", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      const cards = container.querySelectorAll("[class*='card']");
      expect(cards[0]?.className).toMatch(/cardSelected/);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(container.querySelectorAll("[class*='card']")[1]?.className).toMatch(/cardSelected/);
    });

    it("ArrowUp selects the last row when nothing is selected", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp" });
      expect(container.querySelectorAll("[class*='card']")[1]?.className).toMatch(/cardSelected/);
    });

    it("Enter cycles the selected row's status", () => {
      const data = twoRows();
      mockUseListData.mockReturnValue(data);
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(data.onCycleStatus).toHaveBeenCalledWith("task-a");
    });

    it("Enter does nothing for a blocked selected row", () => {
      const data = listData({ rows: [row({ isBlocked: true })] });
      mockUseListData.mockReturnValue(data);
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(data.onCycleStatus).not.toHaveBeenCalled();
    });

    it("R starts an inline rename of the selected row", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "r", code: "KeyR" });
      expect(screen.getByRole("textbox")).toHaveValue("task-a");
    });

    it("committing a rename calls renameNode with the task kind", () => {
      const data = twoRows();
      mockUseListData.mockReturnValue(data);
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "r", code: "KeyR" });
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Renamed" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(data.renameNode).toHaveBeenCalledWith("task-a", "task", "Renamed");
    });

    it("Escape deselects the current row", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(container.querySelector("[class*='cardSelected']")).not.toBeNull();
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(container.querySelector("[class*='cardSelected']")).toBeNull();
    });

    it("Alt+F toggles the filter popover", () => {
      render(<ListView />);
      fireEvent.keyDown(window, { key: "f", code: "KeyF", altKey: true });
      expect(useFilterStore.getState().popoverOpen).toBe(true);
    });

    it("Alt+P sets the Plan status preset in both stores", () => {
      render(<ListView />);
      fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });
      expect(useFilterStore.getState().filter.statusMode).toBe("plan");
      expect(useListFilterStore.getState().filter.preset).toBe("plan");
    });

    it("navigation skips path header entries, selecting only task rows", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      // Path headers aren't TaskRow cards at all, so the selection must land on the first task card.
      const selected = container.querySelector("[class*='cardSelected']");
      expect(selected).not.toBeNull();
      expect(selected?.textContent).toContain("task-a");
    });
  });
});
