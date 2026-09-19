import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ListView from "./ListView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import type { CommitmentListRow, TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useListData } from "@/hooks/use-list-data";
import { LIST_SCROLL_STEP_PX } from "@/hooks/use-list-scroll";

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
    onCommitmentSave: vi.fn(),
    checkScopeClamp: vi.fn(),
  }),
}));
vi.mock("@/components/TaskEditorModal/TaskEditorModal", () => ({ default: () => <div data-testid="editor-modal" /> }));
vi.mock("@/components/CommitmentEditorModal/CommitmentEditorModal", () => ({ default: () => <div data-testid="commitment-editor-modal" /> }));
const updateCommitment = vi.fn((_id: number, _request: unknown) => Promise.resolve());
vi.mock("@/api/commitments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commitments")>()),
  updateCommitment: (id: number, request: unknown) => updateCommitment(id, request),
}));
const setHabitItemStatus = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/api/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/flows")>()),
  setHabitItemStatus: (...args: unknown[]) => setHabitItemStatus(...args),
}));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** A tree holding whatever rows a test supplies, since the verdict hook looks its node up in it
 * before writing — a stub tree with nothing in it would make every write a silent no-op. */
function treeWith(...nodes: MindmapNode[]): MindmapNode {
  return { ...n("root", "domain"), children: nodes };
}

function commitmentRow(over: Partial<CommitmentListRow> = {}): CommitmentListRow {
  return {
    node: n("commitment-1", "commitment", { verdict: "unresolved", timing: "active" }),
    parentRef: "project-1",
    ancestors: [n("aspect-1", "aspect"), n("project-1", "project", { status: "active" })],
    hasPrivateAncestor: false,
    scopeTokens: ["active", "unplanned"],
    ...over,
  };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    parentRef: "goal-1",
    ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" })],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    isAgentic: false,
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
    commitmentRows: [],
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
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useDisplayStore.setState({ pathHeaderIcons: true });
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
      rows: [row({ parentRef: "", ancestors: [], goalRef: null, goalStatus: null })],
    }));
    render(<ListView />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.queryByTitle("enterSubtree")).not.toBeInTheDocument();
  });

  // The chain is read for where it ends, so the header is marked with the kind of its nearest
  // ancestor — the node the rows below hang directly from — once, not once per step.
  it("marks a path header with the node kind of the nearest ancestor", () => {
    render(<ListView />);
    const [firstSegment] = screen.getAllByTitle("enterSubtree");
    const header = firstSegment?.parentElement;
    if (header === null || header === undefined) throw new Error("expected a path header");
    expect(header.querySelectorAll("svg")).toHaveLength(1);
    expect([...header.querySelectorAll("button")].some((b) => b.querySelector("svg") !== null)).toBe(false);
  });

  it("drops the glyph when the settings popover's Path icons switch is off, keeping the chain", () => {
    useDisplayStore.setState({ pathHeaderIcons: false });
    render(<ListView />);
    const [firstSegment] = screen.getAllByTitle("enterSubtree");
    const header = firstSegment?.parentElement;
    if (header === null || header === undefined) throw new Error("expected a path header");
    expect(header.querySelectorAll("svg")).toHaveLength(0);
    // Only the glyph goes — the header still names where the run lives.
    expect(screen.getByText("aspect-1")).toBeInTheDocument();
    expect(screen.getAllByText("goal-1")).toHaveLength(2);
  });

  it("marks no path header whose nearest ancestor is an Aspect, which carries no glyph anywhere", () => {
    mockUseListData.mockReturnValue(listData({
      rows: [row({ parentRef: "aspect-1", ancestors: [n("aspect-1", "aspect")], goalRef: null, goalStatus: null })],
    }));
    render(<ListView />);
    const [firstSegment] = screen.getAllByTitle("enterSubtree");
    const header = firstSegment?.parentElement;
    if (header === null || header === undefined) throw new Error("expected a path header");
    expect(header.querySelectorAll("svg")).toHaveLength(0);
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
          ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" }), parent],
        }),
      ],
    }));
    render(<ListView />);
    // The Do preset filters the parent out as a row, so it moves into the header instead.
    expect(screen.getAllByTitle("enterSubtree").map((segment) => segment.textContent))
      .toEqual(["aspect-1", "goal-1", "task-parent"]);
  });

  describe("indentation", () => {
    /** The depth each rendered card is indented to, in the order the cards appear. */
    function renderedDepths(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll<HTMLElement>("[class*='card']"))
        .map((card) => card.style.getPropertyValue("--row-depth"));
    }

    /** A three-generation chain of task rows: only the eldest is to-do, so Do hides it. */
    function nestedRows() {
      const parent = n("task-parent", "task", { status: "todo" });
      const child = n("task-child", "task", { status: "in_progress" });
      const aspect = n("aspect-1", "aspect");
      const goal = n("goal-1", "goal", { status: "active" });
      return [
        row({ node: parent }),
        row({
          node: child,
          parentRef: "task-parent",
          ancestors: [aspect, goal, parent],
        }),
        row({
          node: n("task-grandchild", "task", { status: "in_progress" }),
          parentRef: "task-child",
          ancestors: [aspect, goal, parent, child],
        }),
      ];
    }

    it("indents each row once per ancestor shown above it", () => {
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListView />);
      expect(renderedDepths(container)).toEqual(["0", "1", "2"]);
    });

    it("sits a subtask flush when the filter hides its parent, rather than indenting under nothing", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListView />);
      // Do drops the to-do eldest, so the child it leaves at the top of the run indents under nothing.
      expect(renderedDepths(container)).toEqual(["0", "1"]);
    });

    it("leaves a flat list unindented, costing it no horizontal room", () => {
      const { container } = render(<ListView />);
      expect(renderedDepths(container)).toEqual(["0"]);
    });

    it("ArrowDown walks indented rows in the order they are drawn", () => {
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListView />);
      const selectedIndexes: number[] = [];
      for (let step = 0; step < 3; step++) {
        fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
        const cards = Array.from(container.querySelectorAll("[class*='card']"));
        selectedIndexes.push(cards.findIndex((card) => card.className.includes("cardSelected")));
      }
      // Visual order, not tree order: the indented rows are walked exactly as they are drawn.
      expect(selectedIndexes).toEqual([0, 1, 2]);
    });
  });

  /** A board whose tree really holds the path segments, so entering one resolves a descriptor. */
  function withPathTree() {
    return listData({
      tree: n("root", "domain", {
        children: [n("aspect-1", "aspect", { title: "Growth", children: [n("goal-1", "goal", { status: "active" })] })],
      }),
    });
  }

  it("clicking a path segment enters that segment's subtree, exactly as Ctrl+O does", () => {
    mockUseListData.mockReturnValue(withPathTree());
    render(<ListView />);
    const [aspectSegment] = screen.getAllByTitle("enterSubtree");
    if (aspectSegment === undefined) throw new Error("expected a path header segment");
    fireEvent.click(aspectSegment);
    expect(useMindmapStore.getState().subtreeRootId).toBe("aspect-1");
    // The same descriptor a search-result entry publishes, so the top bar names where you landed.
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      currentTitle: "Growth",
      rootTitle: "root",
      parentTitle: "root",
      parentSubtreeId: null,
    });
  });

  it("clicking a path segment touches no filter at all", () => {
    mockUseListData.mockReturnValue(withPathTree());
    render(<ListView />);
    const [aspectSegment] = screen.getAllByTitle("enterSubtree");
    if (aspectSegment === undefined) throw new Error("expected a path header segment");
    fireEvent.click(aspectSegment);
    expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
    expect(useFilterStore.getState().filter.statusMode).toBe(DEFAULT_FILTER.statusMode);
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

    /** Projects to find by name, one nested inside another so "up one level" and "back to the
     * root" are different destinations. */
    function searchable() {
      return listData({
        tree: n("root", "domain", {
          children: [
            n("project-1", "project", {
              title: "ARLESH",
              children: [n("project-2", "project", { title: "Deeper" })],
            }),
            n("project-3", "project", { title: "Elsewhere" }),
          ],
        }),
        rows: [row({ node: n("task-a", "task", { status: "todo" }) })],
      });
    }

    /** Presses the chord and types a query, returning the search input. */
    function openSearch(query: string): HTMLElement {
      fireEvent.keyDown(window, { key: "o", code: "KeyO", ctrlKey: true });
      const input = screen.getByPlaceholderText("common:searchNodesPlaceholder");
      fireEvent.change(input, { target: { value: query } });
      return input;
    }

    it("Ctrl+O opens the node search over every node kind", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
      openSearch("arlesh");
      expect(screen.getByText("ARLESH")).toBeInTheDocument();
    });

    it("picking a search result enters that node's subtree", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
    });

    it("picking a search result touches no filter at all", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
      expect(useFilterStore.getState().filter.statusMode).toBe(DEFAULT_FILTER.statusMode);
    });

    it("entering a subtree publishes the back-nav descriptor the top bar's pills render from", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      // The Mindmap is unmounted here, so the List View has to be the one publishing this.
      expect(useMindmapStore.getState().subtreeNav).toEqual({
        currentTitle: "ARLESH",
        rootTitle: "root",
        parentTitle: "root",
        parentSubtreeId: null,
      });

      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      expect(useMindmapStore.getState().subtreeNav).toEqual({
        currentTitle: "Deeper",
        rootTitle: "root",
        parentTitle: "ARLESH",
        parentSubtreeId: "project-1",
      });
    });

    it("Shift+Escape goes up one level, not straight out", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", shiftKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", shiftKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("Ctrl+Escape goes straight back to the root from any depth", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", ctrlKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("bare Escape deselects without leaving the subtree", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
    });

    it("Escape closes the node search without entering anything", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListView />);
      const input = openSearch("arlesh");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

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

  /**
   * jsdom implements neither scrolling nor layout: `scrollIntoView` and `scrollBy` do not exist and
   * every element measures zero. These stubs record what the view asked the viewport to do, which is
   * what the bindings are responsible for. Whether a `nearest` alignment actually leaves an
   * already-visible row alone is the browser's contract and is not exercised here.
   */
  describe("scrolling", () => {
    let intoViewRows: Array<string | null> = [];
    let scrollByCalls: ScrollToOptions[] = [];
    const originalIntoView = Element.prototype.scrollIntoView;
    const originalScrollBy = Element.prototype.scrollBy;

    beforeEach(() => {
      intoViewRows = [];
      scrollByCalls = [];
      Element.prototype.scrollIntoView = function () {
        intoViewRows.push(this.getAttribute("data-row-id"));
      };
      Element.prototype.scrollBy = function (options?: ScrollToOptions | number) {
        if (typeof options === "object") scrollByCalls.push(options);
      };
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalIntoView;
      Element.prototype.scrollBy = originalScrollBy;
    });

    function twoRows() {
      return listData({
        rows: [
          row({ node: n("task-a", "task", { status: "todo" }) }),
          row({ node: n("task-b", "task", { status: "todo" }) }),
        ],
      });
    }

    it("brings each newly selected row into view as the arrows move", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(intoViewRows).toEqual(["task-a", "task-b"]);
    });

    it("brings a selected commitment into view the same way as a task row", () => {
      mockUseListData.mockReturnValue(listData({
        commitmentRows: [commitmentRow()],
        rows: [row()],
        tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })),
      }));
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(intoViewRows).toEqual(["commitment-1"]);
    });

    it("J scrolls down a fixed step and leaves the selection where it is", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      intoViewRows = [];

      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });

      expect(scrollByCalls).toEqual([{ top: LIST_SCROLL_STEP_PX, behavior: "auto" }]);
      expect(container.querySelector("[class*='cardSelected']")?.textContent).toContain("task-a");
      // The selection did not move, so nothing pulled the viewport back to it.
      expect(intoViewRows).toEqual([]);
    });

    it("K scrolls up by the same step", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListView />);
      fireEvent.keyDown(window, { key: "k", code: "KeyK" });
      fireEvent.keyUp(window, { key: "k", code: "KeyK" });
      expect(scrollByCalls).toEqual([{ top: -LIST_SCROLL_STEP_PX, behavior: "auto" }]);
    });

    it("leaves a held key to the animation loop rather than acting on auto-repeat", () => {
      // The press starts a continuous scroll at a speed this app sets; if the repeats were acted on
      // too they would restart it, and the pace would be the OS's key-repeat setting again.
      mockUseListData.mockReturnValue(twoRows());
      render(<ListView />);
      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyDown(window, { key: "j", code: "KeyJ", repeat: true });
      fireEvent.keyDown(window, { key: "j", code: "KeyJ", repeat: true });
      expect(scrollByCalls).toEqual([{ top: LIST_SCROLL_STEP_PX, behavior: "auto" }]);
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });
    });

    it("scrolls with no selection at all", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListView />);
      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });
      expect(scrollByCalls).toHaveLength(1);
      expect(container.querySelector("[class*='cardSelected']")).toBeNull();
    });

    it("re-anchors on the selection when the arrows move it after a J scroll", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListView />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });
      intoViewRows = [];

      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });

      expect(intoViewRows).toEqual(["task-b"]);
    });
  });
  describe("focus exemption", () => {
    const todo = () => row({ node: n("task-1", "task", { status: "todo" }) });
    const done = () => row({ node: n("task-1", "task", { status: "done" }) });
    const neighbour = () => row({ node: n("task-2", "task", { status: "todo" }) });

    /** Selects task-1 under Plan, then completes it — the edit that used to make it vanish. */
    function completeSelectedTaskUnderPlan() {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
      mockUseListData.mockReturnValue(listData({ rows: [todo(), neighbour()] }));
      const view = render(<ListView />);
      fireEvent.click(screen.getByText("task-1"));
      mockUseListData.mockReturnValue(listData({ rows: [done(), neighbour()] }));
      view.rerender(<ListView />);
      return view;
    }

    it("leaves a task you complete under Plan on screen", () => {
      completeSelectedTaskUnderPlan();
      expect(screen.getByText("task-1")).toBeInTheDocument();
    });

    it("dims it, so it reads as something the filter no longer wants", () => {
      const { container } = completeSelectedTaskUnderPlan();
      const dimmed = container.querySelector("[class*='cardFocusExempt']");
      expect(dimmed?.textContent).toContain("task-1");
    });

    it("removes it as soon as the selection moves to another row", () => {
      completeSelectedTaskUnderPlan();
      fireEvent.click(screen.getByText("task-2"));
      expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    });

    it("removes it as soon as Escape clears the selection", () => {
      completeSelectedTaskUnderPlan();
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    });

    it("removes it as soon as any filter is toggled", () => {
      completeSelectedTaskUnderPlan();
      act(() => { useFilterStore.getState().togglePrivateMode(); });
      expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    });

    it("leaves every other row exactly as the filter had it", () => {
      completeSelectedTaskUnderPlan();
      expect(screen.getByText("task-2")).toBeInTheDocument();
    });
  });
});

describe("ListView — the commitments section", () => {
  /** Every card on screen, in document order, by the title button each one carries. */
  function cardTitles(): string[] {
    return screen.getAllByRole("button").filter((el) => el.className.includes("title")).map((el) => el.textContent ?? "");
  }

  beforeEach(() => {
    updateCommitment.mockClear();
    setHabitItemStatus.mockClear();
  });

  it("renders commitments as their own section above the task rows", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [row()], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" }), n("task-1", "task")) }));
    render(<ListView />);

    expect(screen.getByRole("region", { name: "listView:commitmentsHeading" })).toBeInTheDocument();
    // The band reads first: a commitment is a standing rule, not work scattered through the list.
    expect(cardTitles()).toEqual(["commitment-1", "task-1"]);
  });

  it("shows no section at all when no commitment matches", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [], rows: [row()] }));
    render(<ListView />);
    expect(screen.queryByRole("region", { name: "listView:commitmentsHeading" })).not.toBeInTheDocument();
  });

  it("records Kept when the tick is clicked", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })) }));
    render(<ListView />);

    fireEvent.click(screen.getByRole("button", { name: "markKept" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "kept" });
  });

  it("records Broken when the cross is clicked", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })) }));
    render(<ListView />);

    fireEvent.click(screen.getByRole("button", { name: "markBroken" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "broken" });
  });

  it("clears the verdict when the control that already reads it is pressed again", () => {
    // A misclick has to be recoverable, and the way back is the same control.
    mockUseListData.mockReturnValue(listData({
      commitmentRows: [commitmentRow({ node: n("commitment-1", "commitment", { verdict: "kept" }) })],
      rows: [],
      tree: treeWith(n("commitment-1", "commitment", { verdict: "kept" })),
    }));
    render(<ListView />);

    fireEvent.click(screen.getByRole("button", { name: "clearVerdict" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "unresolved" });
  });

  it("never moves straight from one verdict to the other", () => {
    // Pressing the cross on a kept commitment records Broken; it does not clear first, and
    // nothing ever cycles Kept → Broken by repetition.
    mockUseListData.mockReturnValue(listData({
      commitmentRows: [commitmentRow({ node: n("commitment-1", "commitment", { verdict: "kept" }) })],
      rows: [],
      tree: treeWith(n("commitment-1", "commitment", { verdict: "kept" })),
    }));
    render(<ListView />);

    fireEvent.click(screen.getByRole("button", { name: "markBroken" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "broken" });
  });

  it("marks the selected commitment kept on Enter and broken on X", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })) }));
    render(<ListView />);

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "kept" });

    updateCommitment.mockClear();
    fireEvent.keyDown(window, { key: "x", code: "KeyX" });
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "broken" });
  });

  it("gives a commitment Habit's iteration the same two verdict controls as any other commitment", () => {
    // Its verdict has nowhere else to go: the iteration is virtual, so it is written as that
    // iteration's Modification rather than against a commitments row it does not have.
    const iteration = n("habit-3-0-virtual", "commitment", {
      title: "Asleep by 23:00 Mon",
      verdict: "unresolved",
      virtual: true,
      habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100, cycleId: 0 },
    });
    mockUseListData.mockReturnValue(listData({
      commitmentRows: [commitmentRow({ node: iteration })],
      rows: [],
      tree: treeWith(iteration),
    }));
    render(<ListView />);

    fireEvent.click(screen.getByRole("button", { name: "markBroken" }));
    expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 100, 0, "broken", expect.any(Number));
    expect(updateCommitment).not.toHaveBeenCalled();
  });

  it("leaves Enter meaning 'cycle the status' when the selected row is a task", () => {
    const data = listData({ commitmentRows: [], rows: [row()] });
    mockUseListData.mockReturnValue(data);
    render(<ListView />);

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(data.onCycleStatus).toHaveBeenCalledWith("task-1");
    expect(updateCommitment).not.toHaveBeenCalled();
  });
});
