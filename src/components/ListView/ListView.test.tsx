import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import ListView from "./ListView";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import type { CommitmentListRow, TaskListRow } from "@/utils/list-filter";
import { fixtureRowId } from "@/test/node-fixture";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { Verdict } from "@/api/verdict";
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
    occurrenceEditor: { target: null, open: vi.fn(), close: vi.fn(), save: vi.fn(), setDeleted: vi.fn() },
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
const setHabitInstanceDeleted = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/api/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/flows")>()),
  setHabitItemStatus: (...args: unknown[]) => setHabitItemStatus(...args),
  setHabitInstanceDeleted: (...args: unknown[]) => setHabitInstanceDeleted(...args),
}));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

/**
 * The List View as the app actually mounts it: its own binding table **and** the global one.
 *
 * The two are never apart in the running app, and several chords the list responds to are declared
 * globally — the subtree exits, `Ctrl+O`, `Alt+F` — while the thing they affect (the search modal,
 * the filter popover, the rows) is drawn by the view. Rendering the view alone would assert on half
 * a mechanism and quietly pass whatever the other half did.
 */
function ListViewInApp() {
  useGlobalHotkeys();
  return <ListView />;
}

/** A row id per fixture id, stable across the file. `commitment-7` draws row 7; a fixture named
 * by word (`task-parent`) draws one of its own, numbered from 1000 so it meets no numbered one. */
const wordRows = new Map<string, number>();
function fixtureRow(id: string): number {
  const numbered = fixtureRowId(id).rowId;
  if (numbered !== undefined) return numbered;
  const known = wordRows.get(id);
  if (known !== undefined) return known;
  const next = 1000 + wordRows.size;
  wordRows.set(id, next);
  return next;
}

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  const rowId = id === "root" || extra.virtual === true ? {} : { rowId: fixtureRow(id) };
  return { id, ...rowId, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** A tree holding whatever rows a test supplies, since the verdict hook looks its node up in it
 * before writing — a stub tree with nothing in it would make every write a silent no-op. */
function treeWith(...nodes: MindmapNode[]): MindmapNode {
  return { ...n("root", "domain"), children: nodes };
}

function commitmentRow(over: Partial<CommitmentListRow> = {}): CommitmentListRow {
  return {
    node: n("commitment-1", "commitment", { verdict: "unresolved", timing: "active" }),
    ancestors: [n("aspect-1", "aspect"), n("project-1", "project", { status: "active" })],
    hasPrivateAncestor: false,
    scopeTokens: ["active", "unplanned"],
    ...over,
  };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" })],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    isAgentic: false,
    isAsynchronous: false,
    hasBlockedAncestor: false,
    hasPrivateAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

/** A path header's **kind glyph**: the svg drawn straight into the row, as opposed to the one
 * inside its `+` button. Counting every svg in the header would conflate the two. */
function headerGlyphs(header: Element): Element[] {
  return [...header.children].filter((el) => el.tagName.toLowerCase() === "svg");
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
    createTask: vi.fn(() => Promise.resolve(n("task-new", "task", { status: "todo" }))),
    deleteTask: vi.fn(() => Promise.resolve()),
    removeNode: vi.fn(() => Promise.resolve()),
    occurrencePrompt: null,
    confirmOccurrence: vi.fn(),
    cancelOccurrence: vi.fn(),
    setOccurrenceStatus: vi.fn(),
    ...overrides,
  };
}

const mockUseListData = vi.mocked(useListData);

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  mockUseListData.mockReturnValue(listData());
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useDisplayStore.setState({ asynchronousFirst: false });
});

describe("ListView — Asynchronous first", () => {
  const aspect = () => n("aspect-1", "aspect");
  const goal = () => n("goal-1", "goal", { status: "active" });

  /** The user's own case: one asynchronous task, alone among its siblings, deep inside a subtree —
   * with nothing to overtake where it stands. */
  function nestedRows() {
    const parent = n("task-parent", "task", { status: "todo" });
    return [
      row({ node: parent, ancestors: [aspect(), goal()] }),
      row({ node: n("task-first", "task", { status: "todo" }), ancestors: [aspect(), goal(), parent] }),
      row({
        node: n("task-wait", "task", { status: "todo", asynchronous: true }),
        ancestors: [aspect(), goal(), parent],
        isAsynchronous: true,
      }),
      row({ node: n("task-last", "task", { status: "todo" }), ancestors: [aspect(), goal(), parent] }),
    ];
  }

  /** The titles of the rendered rows, in the order they are drawn. */
  function renderedTitles(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[class*='card']"))
      .map((card) => card.querySelector("button[class*='title']")?.textContent ?? "");
  }

  /** Each path header drawn, as the chain of segment titles it names. */
  function renderedHeaders(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[class*='header']")).map((header) =>
      Array.from(header.querySelectorAll("button[class*='segment']"))
        .map((segment) => segment.textContent)
        .join(" > "),
    );
  }

  function renderedDepths(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[class*='card']"))
      .map((card) => card.style.getPropertyValue("--row-depth"));
  }

  /** Everything the list draws, in the order it draws it: section headings, the rule that closes
   * the Asynchronous section, path headers and rows. */
  function renderedBlocks(container: HTMLElement): string[] {
    const drawn = container.querySelectorAll<HTMLElement>(
      "h2, [class*='sectionEnd'], [class*='header'], [class*='card']",
    );
    return Array.from(drawn).map((element) => {
      if (element.tagName === "H2") return `section:${element.textContent}`;
      if (element.className.includes("sectionEnd")) return "rule";
      if (element.className.includes("card")) {
        return `row:${element.querySelector("button[class*='title']")?.textContent ?? ""}`;
      }
      return `header:${Array.from(element.querySelectorAll("button[class*='segment']"))
        .map((segment) => segment.textContent)
        .join(" > ")}`;
    });
  }

  it("leaves row order exactly as the tree gave it, and draws no section, while the setting is off", () => {
    mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
    const { container } = render(<ListViewInApp />);
    expect(renderedTitles(container)).toEqual(["task-parent", "task-first", "task-wait", "task-last"]);
    expect(screen.queryByText("listView:asynchronousHeading")).not.toBeInTheDocument();
  });

  it("lifts the asynchronous row into a section at the top once the setting is on", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
    const { container } = render(<ListViewInApp />);
    expect(screen.getByText("listView:asynchronousHeading")).toBeInTheDocument();
    expect(renderedTitles(container)).toEqual(["task-wait", "task-parent", "task-first", "task-last"]);
  });

  it("names the parent the lifted row left behind in the section's own path header", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
    const { container } = render(<ListViewInApp />);
    expect(renderedHeaders(container)).toEqual([
      "aspect-1 > goal-1 > task-parent",
      "aspect-1 > goal-1",
    ]);
  });

  it("moves the row rather than duplicating it", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
    const { container } = render(<ListViewInApp />);
    expect(renderedTitles(container).filter((title) => title === "task-wait")).toHaveLength(1);
  });

  it("carries a lifted row's children with it, indentation intact", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    const waiting = n("task-wait", "task", { status: "todo", asynchronous: true });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({ node: n("task-plain", "task", { status: "todo" }), ancestors: [aspect(), goal()] }),
        row({ node: waiting, ancestors: [aspect(), goal()], isAsynchronous: true }),
        row({ node: n("task-child", "task", { status: "todo" }), ancestors: [aspect(), goal(), waiting] }),
      ],
    }));
    const { container } = render(<ListViewInApp />);
    expect(renderedTitles(container)).toEqual(["task-wait", "task-child", "task-plain"]);
    expect(renderedDepths(container)).toEqual(["0", "1", "0"]);
  });

  it("lifts an outer asynchronous subtree once, so a nested asynchronous row does not lift twice", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    const outer = n("task-outer", "task", { status: "todo", asynchronous: true });
    const middle = n("task-middle", "task", { status: "todo" });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({ node: outer, ancestors: [aspect(), goal()], isAsynchronous: true }),
        row({ node: middle, ancestors: [aspect(), goal(), outer] }),
        row({
          node: n("task-inner", "task", { status: "todo", asynchronous: true }),
          ancestors: [aspect(), goal(), outer, middle],
          isAsynchronous: true,
        }),
      ],
    }));
    const { container } = render(<ListViewInApp />);
    expect(renderedTitles(container)).toEqual(["task-outer", "task-middle", "task-inner"]);
    expect(renderedDepths(container)).toEqual(["0", "1", "2"]);
    expect(renderedHeaders(container)).toEqual(["aspect-1 > goal-1"]);
  });

  it("draws no section when no row is asynchronous", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({
      rows: [row({ node: n("task-plain", "task", { status: "todo" }), ancestors: [aspect(), goal()] })],
    }));
    const { container } = render(<ListViewInApp />);
    expect(screen.queryByText("listView:asynchronousHeading")).not.toBeInTheDocument();
    expect(renderedHeaders(container)).toEqual(["aspect-1 > goal-1"]);
  });

  it("leaves no stray header below when every row is asynchronous", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({
          node: n("task-wait", "task", { status: "todo", asynchronous: true }),
          ancestors: [aspect(), goal()],
          isAsynchronous: true,
        }),
      ],
    }));
    const { container } = render(<ListViewInApp />);
    expect(screen.getByText("listView:asynchronousHeading")).toBeInTheDocument();
    expect(renderedHeaders(container)).toEqual(["aspect-1 > goal-1"]);
    expect(renderedTitles(container)).toEqual(["task-wait"]);
  });

  it("keeps a focus-exempt asynchronous row in the section rather than dropping it", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
    const todo = n("task-wait", "task", { status: "todo", asynchronous: true });
    const done = n("task-wait", "task", { status: "done", asynchronous: true });
    const waiting = (node: MindmapNode) =>
      row({ node, ancestors: [aspect(), goal()], isAsynchronous: true });
    const neighbour = row({ node: n("task-plain", "task", { status: "todo" }), ancestors: [aspect(), goal()] });
    mockUseListData.mockReturnValue(listData({ rows: [waiting(todo), neighbour] }));
    const view = render(<ListViewInApp />);
    fireEvent.click(screen.getByText("task-wait"));
    mockUseListData.mockReturnValue(listData({ rows: [waiting(done), neighbour] }));
    view.rerender(<ListViewInApp />);
    expect(renderedTitles(view.container)).toEqual(["task-wait", "task-plain"]);
    expect(view.container.querySelector("[class*='cardFocusExempt']")?.textContent).toContain("task-wait");
  });

  it("closes the section with a rule, between its last row and the first ordinary header", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
    const { container } = render(<ListViewInApp />);
    expect(renderedBlocks(container)).toEqual([
      "section:listView:asynchronousHeading",
      "header:aspect-1 > goal-1 > task-parent",
      "row:task-wait",
      "rule",
      "header:aspect-1 > goal-1",
      "row:task-parent",
      "row:task-first",
      "row:task-last",
    ]);
  });

  it("draws no closing rule when every row is asynchronous, rather than a line into empty space", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({
          node: n("task-wait", "task", { status: "todo", asynchronous: true }),
          ancestors: [aspect(), goal()],
          isAsynchronous: true,
        }),
      ],
    }));
    const { container } = render(<ListViewInApp />);
    expect(renderedBlocks(container)).toEqual([
      "section:listView:asynchronousHeading",
      "header:aspect-1 > goal-1",
      "row:task-wait",
    ]);
  });

  it("draws no closing rule when no row is asynchronous, since there is no section to close", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({
      rows: [row({ node: n("task-plain", "task", { status: "todo" }), ancestors: [aspect(), goal()] })],
    }));
    const { container } = render(<ListViewInApp />);
    expect(renderedBlocks(container)).toEqual([
      "header:aspect-1 > goal-1",
      "row:task-plain",
    ]);
  });

  it("walks the commitments band, the section and the ordinary list as one run of arrow presses", () => {
    useDisplayStore.setState({ asynchronousFirst: true });
    mockUseListData.mockReturnValue(listData({
      commitmentRows: [commitmentRow()],
      rows: [
        row({ node: n("task-plain", "task", { status: "todo" }), ancestors: [aspect(), goal()] }),
        row({
          node: n("task-wait", "task", { status: "todo", asynchronous: true }),
          ancestors: [aspect(), goal()],
          isAsynchronous: true,
        }),
      ],
    }));
    const { container } = render(<ListViewInApp />);
    const selected: string[] = [];
    for (let step = 0; step < 3; step++) {
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      const card = container.querySelector("[class*='cardSelected']");
      selected.push(card?.querySelector("button[class*='title']")?.textContent ?? "");
    }
    // The band first, then the section, then what the section left behind — no dead stop, nothing skipped.
    expect(selected).toEqual(["commitment-1", "task-wait", "task-plain"]);
  });
});

describe("ListView", () => {
  it("renders a task row", () => {
    render(<ListViewInApp />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    mockUseListData.mockReturnValue(listData({ rows: [], isLoading: true }));
    render(<ListViewInApp />);
    expect(screen.getByText("common:loading")).toBeInTheDocument();
  });

  it("shows the empty state when no rows pass the filter", () => {
    mockUseListData.mockReturnValue(listData({ rows: [] }));
    render(<ListViewInApp />);
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
    render(<ListViewInApp />);
    expect(screen.queryByText("task-open")).not.toBeInTheDocument();
    expect(screen.getByText("task-blocked")).toBeInTheDocument();
  });

  it("names a run's whole chain in a path header above it", () => {
    render(<ListViewInApp />);
    expect(screen.getByText("aspect-1")).toBeInTheDocument();
    // "goal-1" reads once, as the last path segment: the row card carries no parent label.
    expect(screen.getAllByText("goal-1")).toHaveLength(1);
  });

  it("renders no path header for a task with no ancestors", () => {
    mockUseListData.mockReturnValue(listData({
      rows: [row({ ancestors: [], goalRef: null, goalStatus: null })],
    }));
    render(<ListViewInApp />);
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.queryByTitle("pathSegmentActions")).not.toBeInTheDocument();
  });

  // The header used to open with a glyph for its nearest ancestor, behind a *Path icons* switch in
  // the settings popover. Both are gone: a header is its titles, its separators and its `+`.
  it("draws no kind glyph before the chain", () => {
    render(<ListViewInApp />);
    const [firstSegment] = screen.getAllByTitle("pathSegmentActions");
    const header = firstSegment?.parentElement;
    if (header === null || header === undefined) throw new Error("expected a path header");
    expect(headerGlyphs(header)).toHaveLength(0);
    // Only the glyph went — the header still names where the run lives.
    expect(screen.getByText("aspect-1")).toBeInTheDocument();
    expect(screen.getAllByText("goal-1")).toHaveLength(1);
  });

  it("names an ancestor task the active filter hides, so an orphaned subtask still reads in context", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    const parent = n("task-parent", "task", { status: "todo" });
    mockUseListData.mockReturnValue(listData({
      rows: [
        row({ node: parent }),
        row({
          node: n("task-child", "task", { status: "in_progress" }),
          ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" }), parent],
        }),
      ],
    }));
    render(<ListViewInApp />);
    // The Do preset filters the parent out as a row, so it moves into the header instead.
    expect(screen.getAllByTitle("pathSegmentActions").map((segment) => segment.textContent))
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
          ancestors: [aspect, goal, parent],
        }),
        row({
          node: n("task-grandchild", "task", { status: "in_progress" }),
          ancestors: [aspect, goal, parent, child],
        }),
      ];
    }

    it("indents each row once per ancestor shown above it", () => {
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListViewInApp />);
      expect(renderedDepths(container)).toEqual(["0", "1", "2"]);
    });

    it("sits a subtask flush when the filter hides its parent, rather than indenting under nothing", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListViewInApp />);
      // Do drops the to-do eldest, so the child it leaves at the top of the run indents under nothing.
      expect(renderedDepths(container)).toEqual(["0", "1"]);
    });

    it("leaves a flat list unindented, costing it no horizontal room", () => {
      const { container } = render(<ListViewInApp />);
      expect(renderedDepths(container)).toEqual(["0"]);
    });

    it("ArrowDown walks indented rows in the order they are drawn", () => {
      mockUseListData.mockReturnValue(listData({ rows: nestedRows() }));
      const { container } = render(<ListViewInApp />);
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
    render(<ListViewInApp />);
    const [aspectSegment] = screen.getAllByTitle("pathSegmentActions");
    if (aspectSegment === undefined) throw new Error("expected a path header segment");
    fireEvent.click(aspectSegment);
    expect(useMindmapStore.getState().subtreeRootId).toBe("aspect-1");
    // The same descriptor a search-result entry publishes, so the top bar names where you landed.
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      ancestors: [{ id: null, title: "root" }],
      currentTitle: "Growth",
    });
  });

  it("clicking a path segment touches no filter at all", () => {
    mockUseListData.mockReturnValue(withPathTree());
    render(<ListViewInApp />);
    const [aspectSegment] = screen.getAllByTitle("pathSegmentActions");
    if (aspectSegment === undefined) throw new Error("expected a path header segment");
    fireEvent.click(aspectSegment);
    expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
    expect(useFilterStore.getState().filter.statusMode).toBe(DEFAULT_FILTER.statusMode);
  });

  // Plain click re-roots, modifier click narrows. The two are not variations on one action: entering
  // a subtree rebuilds the rows with the segment as the frame and everything outside it is never
  // built, where a pill leaves the flatten alone and filters the result, with a chip naming what is
  // narrowing and the rest of the board one chip-click away.
  describe("modifier-clicking a path segment filters instead of entering", () => {
    /** The first segment of the header — `aspect-1`, which the tree in `withPathTree` really holds. */
    function firstSegment() {
      mockUseListData.mockReturnValue(withPathTree());
      render(<ListViewInApp />);
      const [segment] = screen.getAllByTitle("pathSegmentActions");
      if (segment === undefined) throw new Error("expected a path header segment");
      return segment;
    }

    function antecedentPills() {
      return useListFilterStore.getState().filter.pills.antecedent;
    }

    it("Ctrl+click files the segment as an Antecedent filter and does not enter its subtree", () => {
      fireEvent.click(firstSegment(), { ctrlKey: true });
      expect(antecedentPills()).toEqual([{ value: "aspect-1", mode: "any" }]);
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("Alt+click files it as an excluded Antecedent filter and does not enter its subtree", () => {
      fireEvent.click(firstSegment(), { altKey: true });
      expect(antecedentPills()).toEqual([{ value: "aspect-1", mode: "exclude" }]);
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    // Each gesture names an answer rather than toggling, so the opposite one moves the pill across
    // rather than leaving a second pill for the same node, or silently doing nothing.
    it("Alt+click on a node already filtered for excludes it, rather than duplicating the pill", () => {
      const segment = firstSegment();
      fireEvent.click(segment, { ctrlKey: true });
      fireEvent.click(segment, { altKey: true });
      expect(antecedentPills()).toEqual([{ value: "aspect-1", mode: "exclude" }]);
    });

    // Filtering a branch out takes the run whose header you clicked with it, so the segment is no
    // longer on screen to be clicked back: the chip at the top of the screen is the way back, which
    // is exactly the difference from subtree entry. The include-after-exclude transition itself is
    // pinned on the store, where the chip's own ∅ → ∪ cycle also reaches it.
    it("Alt+click takes the run it heads off screen, leaving the chip as the way back", () => {
      fireEvent.click(firstSegment(), { altKey: true });
      expect(screen.queryAllByTitle("pathSegmentActions")).toHaveLength(0);
      expect(screen.getByText("listView:empty")).toBeInTheDocument();
    });

    // Any and All both keep the node in, so re-asking to include it must not undo an intersection
    // the user set on the chip.
    it("Ctrl+click leaves an All-mode pill exactly as it is", () => {
      const segment = firstSegment();
      fireEvent.click(segment, { ctrlKey: true });
      useListFilterStore.getState().setPillMode("antecedent", "aspect-1", "all");
      fireEvent.click(segment, { ctrlKey: true });
      expect(antecedentPills()).toEqual([{ value: "aspect-1", mode: "all" }]);
    });

    it("leaves the shared filter and the status preset alone", () => {
      fireEvent.click(firstSegment(), { altKey: true });
      expect(useFilterStore.getState().filter).toEqual(DEFAULT_FILTER);
    });
  });

  it("no longer offers a Goal-visibility toggle", () => {
    render(<ListViewInApp />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Parent was retired as a pill dimension: the path header above the run already names a row's
  // parent, so a label on the card restated what was on screen a line above it.
  it("shows no parent label on a task card", () => {
    render(<ListViewInApp />);
    expect(screen.queryByTitle("filterByParent")).not.toBeInTheDocument();
  });

  it("clicking a task's tag pill adds a shared tag filter", () => {
    mockUseListData.mockReturnValue(listData({ rows: [row({ node: n("task-1", "task", { status: "todo", tagIds: [7] }) })] }));
    render(<ListViewInApp />);
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
      render(<ListViewInApp />);
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
      openSearch("arlesh");
      expect(screen.getByText("ARLESH")).toBeInTheDocument();
    });

    it("picking a search result enters that node's subtree", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
    });

    it("picking a search result touches no filter at all", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
      expect(useFilterStore.getState().filter.statusMode).toBe(DEFAULT_FILTER.statusMode);
    });

    it("entering a subtree publishes the chain the top bar's breadcrumb renders from", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      // The Mindmap is unmounted here, so the List View has to be the one publishing this.
      expect(useMindmapStore.getState().subtreeNav).toEqual({
        ancestors: [{ id: null, title: "root" }],
        currentTitle: "ARLESH",
      });

      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      expect(useMindmapStore.getState().subtreeNav).toEqual({
        ancestors: [{ id: null, title: "root" }, { id: "project-1", title: "ARLESH" }],
        currentTitle: "Deeper",
      });
    });

    it("Shift+Escape goes up one level, not straight out", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", shiftKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", shiftKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("Ctrl+Escape goes straight back to the root from any depth", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("deeper");
      fireEvent.mouseDown(screen.getByText("Deeper"));
      fireEvent.keyDown(window, { key: "Escape", code: "Escape", ctrlKey: true });
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("bare Escape deselects without leaving the subtree", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      openSearch("arlesh");
      fireEvent.mouseDown(screen.getByText("ARLESH"));
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
    });

    it("Escape closes the node search without entering anything", () => {
      mockUseListData.mockReturnValue(searchable());
      render(<ListViewInApp />);
      const input = openSearch("arlesh");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
      expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    });

    it("ArrowDown selects the first row when nothing is selected, then moves to the next", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      const cards = container.querySelectorAll("[class*='card']");
      expect(cards[0]?.className).toMatch(/cardSelected/);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(container.querySelectorAll("[class*='card']")[1]?.className).toMatch(/cardSelected/);
    });

    it("ArrowUp selects the last row when nothing is selected", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp" });
      expect(container.querySelectorAll("[class*='card']")[1]?.className).toMatch(/cardSelected/);
    });

    it("Enter cycles the selected row's status", () => {
      const data = twoRows();
      mockUseListData.mockReturnValue(data);
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(data.onCycleStatus).toHaveBeenCalledWith("task-a");
    });

    it("Enter does nothing for a blocked selected row", () => {
      const data = listData({ rows: [row({ isBlocked: true })] });
      mockUseListData.mockReturnValue(data);
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(data.onCycleStatus).not.toHaveBeenCalled();
    });

    it("R starts an inline rename of the selected row", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "r", code: "KeyR" });
      expect(screen.getByRole("textbox")).toHaveValue("task-a");
    });

    it("committing a rename calls renameNode with the task kind", () => {
      const data = twoRows();
      mockUseListData.mockReturnValue(data);
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.keyDown(window, { key: "r", code: "KeyR" });
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Renamed" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(data.renameNode).toHaveBeenCalledWith("task-a", "task", "Renamed");
    });

    it("Escape deselects the current row", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(container.querySelector("[class*='cardSelected']")).not.toBeNull();
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(container.querySelector("[class*='cardSelected']")).toBeNull();
    });

    it("Alt+F toggles the filter popover", () => {
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "f", code: "KeyF", altKey: true });
      expect(useFilterStore.getState().popoverOpen).toBe(true);
    });

    it("Alt+P sets the Plan status preset in both stores", () => {
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });
      expect(useFilterStore.getState().filter.statusMode).toBe("plan");
      expect(useListFilterStore.getState().filter.preset).toBe("plan");
    });

    it("navigation skips path header entries, selecting only task rows", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
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
      render(<ListViewInApp />);
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
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      expect(intoViewRows).toEqual(["commitment-1"]);
    });

    it("J scrolls down a fixed step and leaves the selection where it is", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
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
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "k", code: "KeyK" });
      fireEvent.keyUp(window, { key: "k", code: "KeyK" });
      expect(scrollByCalls).toEqual([{ top: -LIST_SCROLL_STEP_PX, behavior: "auto" }]);
    });

    it("leaves a held key to the animation loop rather than acting on auto-repeat", () => {
      // The press starts a continuous scroll at a speed this app sets; if the repeats were acted on
      // too they would restart it, and the pace would be the OS's key-repeat setting again.
      mockUseListData.mockReturnValue(twoRows());
      render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyDown(window, { key: "j", code: "KeyJ", repeat: true });
      fireEvent.keyDown(window, { key: "j", code: "KeyJ", repeat: true });
      expect(scrollByCalls).toEqual([{ top: LIST_SCROLL_STEP_PX, behavior: "auto" }]);
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });
    });

    it("scrolls with no selection at all", () => {
      mockUseListData.mockReturnValue(twoRows());
      const { container } = render(<ListViewInApp />);
      fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
      fireEvent.keyUp(window, { key: "j", code: "KeyJ" });
      expect(scrollByCalls).toHaveLength(1);
      expect(container.querySelector("[class*='cardSelected']")).toBeNull();
    });

    it("re-anchors on the selection when the arrows move it after a J scroll", () => {
      mockUseListData.mockReturnValue(twoRows());
      render(<ListViewInApp />);
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
      const view = render(<ListViewInApp />);
      fireEvent.click(screen.getByText("task-1"));
      mockUseListData.mockReturnValue(listData({ rows: [done(), neighbour()] }));
      view.rerender(<ListViewInApp />);
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
    render(<ListViewInApp />);

    expect(screen.getByRole("region", { name: "listView:commitmentsHeading" })).toBeInTheDocument();
    // The band reads first: a commitment is a standing rule, not work scattered through the list.
    expect(cardTitles()).toEqual(["commitment-1", "task-1"]);
  });

  it("shows no section at all when no commitment matches", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [], rows: [row()] }));
    render(<ListViewInApp />);
    expect(screen.queryByRole("region", { name: "listView:commitmentsHeading" })).not.toBeInTheDocument();
  });

  it("records Kept when the tick is clicked", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })) }));
    render(<ListViewInApp />);

    fireEvent.click(screen.getByRole("button", { name: "markKept" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "kept" });
  });

  it("records Broken when the cross is clicked", () => {
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow()], rows: [], tree: treeWith(n("commitment-1", "commitment", { verdict: "unresolved" })) }));
    render(<ListViewInApp />);

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
    render(<ListViewInApp />);

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
    render(<ListViewInApp />);

    fireEvent.click(screen.getByRole("button", { name: "markBroken" }));
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: "broken" });
  });

  /** Selects the one commitment row and presses a key on it. */
  function pressOnCommitment(verdict: Verdict, key: { key: string; code: string }) {
    const node = n("commitment-1", "commitment", { verdict, timing: "active" });
    mockUseListData.mockReturnValue(listData({ commitmentRows: [commitmentRow({ node })], rows: [], tree: treeWith(node) }));
    render(<ListViewInApp />);
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(window, key);
  }

  it.each([
    ["unresolved", "kept"],
    ["kept", "broken"],
    ["broken", "unresolved"],
  ] as const)("cycles the selected commitment's verdict on Enter: %s to %s", (current, next) => {
    pressOnCommitment(current, { key: "Enter", code: "Enter" });
    expect(updateCommitment).toHaveBeenCalledWith(1, { verdict: next });
  });

  it.each(["unresolved", "kept"] as const)("records Broken on X from %s, without passing through Kept", (current) => {
    // Enter now walks past Broken, so X is what keeps Broken reachable in one press from
    // anywhere — including from Kept, which Enter would take two presses to leave.
    pressOnCommitment(current, { key: "x", code: "KeyX" });
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
    render(<ListViewInApp />);

    fireEvent.click(screen.getByRole("button", { name: "markBroken" }));
    expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, 100, 0, "broken", expect.any(Number));
    expect(updateCommitment).not.toHaveBeenCalled();
  });

  it("leaves Enter meaning 'cycle the status' when the selected row is a task", () => {
    const data = listData({ commitmentRows: [], rows: [row()] });
    mockUseListData.mockReturnValue(data);
    render(<ListViewInApp />);

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(data.onCycleStatus).toHaveBeenCalledWith("task-1");
    expect(updateCommitment).not.toHaveBeenCalled();
  });
});

describe("ListView — creating tasks", () => {
  /** The row a create is performed from: a live task under `aspect-1 › goal-1`. */
  const anchor = () => row({ node: n("task-a", "task", { status: "in_progress" }) });
  /** The row the reload brings back, as a child of `task-a`. */
  const createdChild = (status: string) =>
    row({
      node: n("task-new", "task", { status }),
      ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" }), n("task-a", "task", { status: "in_progress" })],
    });

  function setup(overrides: Parameters<typeof listData>[0] = {}) {
    const createTask = vi.fn(() => Promise.resolve(n("task-new", "task", { status: "todo" })));
    const deleteTask = vi.fn(() => Promise.resolve());
    const renameNode = vi.fn(() => Promise.resolve());
    mockUseListData.mockReturnValue(listData({ rows: [anchor()], createTask, deleteTask, renameNode, ...overrides }));
    return { createTask, deleteTask, renameNode };
  }

  /** Selects `task-a` and fires `chord`, settling the create it kicks off. */
  async function gestureFromAnchor(code: "Tab" | "Enter", shiftKey = false) {
    fireEvent.click(screen.getByText("task-a"));
    await act(async () => {
      fireEvent.keyDown(window, { key: code, code, shiftKey });
    });
  }

  it("Tab creates a child of the selected row", async () => {
    const { createTask } = setup();
    render(<ListViewInApp />);
    await gestureFromAnchor("Tab");
    expect(createTask).toHaveBeenCalledWith("task-a", "task", undefined);
  });

  it("Shift+Enter creates a sibling, under whatever the selected row hangs from", async () => {
    const { createTask } = setup();
    render(<ListViewInApp />);
    await gestureFromAnchor("Enter", true);
    expect(createTask).toHaveBeenCalledWith("goal-1", "goal", "inherit");
  });

  // The Mindmap's Shift+Enter already does this; the same chord on the same Task must not mean two
  // things depending on which view you happen to be in.
  it("carries the source Task's own Agentic flag onto the sibling", async () => {
    const { createTask } = setup({
      rows: [row({ node: n("task-a", "task", { status: "in_progress", agentic: true }), isAgentic: true })],
    });
    render(<ListViewInApp />);
    await gestureFromAnchor("Enter", true);
    expect(createTask).toHaveBeenCalledWith("goal-1", "goal", "yes");
  });

  // Copying what the source *reads as* would freeze an inherited yes into an explicit one, cutting
  // the sibling off from the ancestor that was deciding for it. An unset source stays unset.
  it("leaves a sibling of an inheriting Task inheriting, rather than pinning it", async () => {
    const { createTask } = setup({
      rows: [row({ node: n("task-a", "task", { status: "in_progress" }), isAgentic: true })],
    });
    render(<ListViewInApp />);
    await gestureFromAnchor("Enter", true);
    expect(createTask).toHaveBeenCalledWith("goal-1", "goal", "inherit");
  });

  it("does nothing with no row selected — there is no parent to read", async () => {
    const { createTask } = setup();
    render(<ListViewInApp />);
    await act(async () => { fireEvent.keyDown(window, { key: "Tab", code: "Tab" }); });
    expect(createTask).not.toHaveBeenCalled();
  });

  // The answer to "nothing selected means no parent": the header already names where the run lives.
  it("the path header's + creates under the chain's last node", () => {
    const { createTask } = setup();
    render(<ListViewInApp />);
    fireEvent.click(screen.getByTitle("createTaskHere"));
    expect(createTask).toHaveBeenCalledWith("goal-1", "goal", undefined);
  });

  it("offers no + where the chain ends somewhere a Task cannot live", () => {
    setup({
      rows: [row({ ancestors: [n("flow-1", "flow")], goalRef: null, goalStatus: null })],
    });
    render(<ListViewInApp />);
    expect(screen.queryByTitle("createTaskHere")).not.toBeInTheDocument();
  });

  it("opens the new row in inline rename, so the title can be typed straight away", async () => {
    setup();
    const view = render(<ListViewInApp />);
    await gestureFromAnchor("Tab");
    mockUseListData.mockReturnValue(listData({ rows: [anchor(), createdChild("todo")] }));
    view.rerender(<ListViewInApp />);
    expect(screen.getByDisplayValue("task-new")).toBeInTheDocument();
  });

  it("discards the new task entirely when that first rename is escaped", async () => {
    const { deleteTask, createTask } = setup();
    const view = render(<ListViewInApp />);
    await gestureFromAnchor("Tab");
    mockUseListData.mockReturnValue(listData({ rows: [anchor(), createdChild("todo")], createTask, deleteTask }));
    view.rerender(<ListViewInApp />);

    fireEvent.keyDown(screen.getByDisplayValue("task-new"), { key: "Escape", code: "Escape" });

    expect(deleteTask).toHaveBeenCalledWith("task-new");
  });

  it("indents the new row under the row it was created from", async () => {
    setup();
    const view = render(<ListViewInApp />);
    await gestureFromAnchor("Tab");
    mockUseListData.mockReturnValue(listData({ rows: [anchor(), createdChild("todo")] }));
    const { container } = view;
    view.rerender(<ListViewInApp />);
    const card = container.querySelector("[data-row-id='task-new']");
    expect(card?.getAttribute("style")).toContain("--row-depth: 1");
  });

  describe("holding the new row visible", () => {
    /** Creates a To Do child under the **Do** preset — the filter that wants it gone — and names it. */
    async function createToDoUnderDo() {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "do" } });
      const handles = setup();
      const view = render(<ListViewInApp />);
      await gestureFromAnchor("Tab");
      mockUseListData.mockReturnValue(listData({ rows: [anchor(), createdChild("todo")], ...handles }));
      view.rerender(<ListViewInApp />);
      fireEvent.keyDown(screen.getByDisplayValue("task-new"), { key: "Enter", code: "Enter" });
      return { view, handles };
    }

    it("keeps a To Do row on screen under the Do preset, which would otherwise drop it", async () => {
      await createToDoUnderDo();
      expect(screen.getByText("task-new")).toBeInTheDocument();
    });

    it("keeps it when its status is cycled to one the filter also refuses", async () => {
      const { view, handles } = await createToDoUnderDo();
      mockUseListData.mockReturnValue(listData({ rows: [anchor(), createdChild("done")], ...handles }));
      view.rerender(<ListViewInApp />);
      expect(screen.getByText("task-new")).toBeInTheDocument();
    });

    it("lets the filter have it back as soon as the selection moves off", async () => {
      const { view } = await createToDoUnderDo();
      // The card, not the title text: the new row carries "task-a" as its parent label too.
      const anchorCard = view.container.querySelector("[data-row-id='task-a']");
      if (anchorCard === null) throw new Error("expected the anchor row");
      fireEvent.click(anchorCard);
      expect(screen.queryByText("task-new")).not.toBeInTheDocument();
    });
  });
});

describe("ListView — deleting a row", () => {
  const taskA = (children: MindmapNode[] = []) => n("task-a", "task", { status: "todo", children });
  const taskB = () => n("task-b", "task", { status: "todo" });
  const childOfA = () => n("task-a1", "task", { status: "todo" });

  /** The list as drawn, with a tree behind it — the delete looks its target up in the tree. */
  function setup(nodes: MindmapNode[], rows: TaskListRow[]) {
    const removeNode = vi.fn(() => Promise.resolve());
    mockUseListData.mockReturnValue(listData({ tree: treeWith(...nodes), rows, removeNode }));
    return { removeNode };
  }

  function twoSiblings() {
    return setup(
      [taskA(), taskB()],
      [row({ node: taskA() }), row({ node: taskB() })],
    );
  }

  /** Selects the row card with this id — by the card, since a child row repeats its parent's
   * title as its parent label — and presses Delete. */
  function deleteRow(id: string) {
    const card = document.querySelector(`[data-row-id='${id}']`);
    if (card === null) throw new Error(`no row ${id}`);
    fireEvent.click(card);
    fireEvent.keyDown(window, { key: "Delete", code: "Delete" });
  }

  async function confirm() {
    await act(async () => {
      fireEvent.click(screen.getByText("warnings:deleteConfirm"));
    });
  }

  it("asks before it writes anything", () => {
    const { removeNode } = twoSiblings();
    render(<ListViewInApp />);
    deleteRow("task-a");
    expect(screen.getByText("warnings:deleteHeading")).toBeInTheDocument();
    expect(removeNode).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirmation is cancelled", () => {
    const { removeNode } = twoSiblings();
    render(<ListViewInApp />);
    deleteRow("task-a");
    fireEvent.click(screen.getByText("common:cancel"));
    expect(screen.queryByText("warnings:deleteHeading")).not.toBeInTheDocument();
    expect(removeNode).not.toHaveBeenCalled();
  });

  it("deletes the row on confirmation", async () => {
    const { removeNode } = twoSiblings();
    render(<ListViewInApp />);
    deleteRow("task-a");
    await confirm();
    expect(removeNode).toHaveBeenCalledWith([{ id: "task-a", kind: "task" }]);
  });

  // The Mindmap's cascade, through the Mindmap's writer: the same one step undo reverses.
  it("takes the row's subtree with it, and says so beforehand", async () => {
    const { removeNode } = setup(
      [taskA([childOfA()]), taskB()],
      [row({ node: taskA([childOfA()]) }), row({ node: taskB() })],
    );
    render(<ListViewInApp />);
    deleteRow("task-a");
    expect(screen.getByText("warnings:deleteWithChildren")).toBeInTheDocument();
    await confirm();
    expect(removeNode).toHaveBeenCalledWith([
      { id: "task-a1", kind: "task" },
      { id: "task-a", kind: "task" },
    ]);
  });

  it("does nothing with no row selected", () => {
    const { removeNode } = twoSiblings();
    render(<ListViewInApp />);
    fireEvent.keyDown(window, { key: "Delete", code: "Delete" });
    expect(screen.queryByText("warnings:deleteHeading")).not.toBeInTheDocument();
    expect(removeNode).not.toHaveBeenCalled();
  });

  // Derived at load time: there is no row behind it, and the Habit's template is not what Delete on
  // one occurrence should take away.
  it("gives a Habit occurrence row a context menu of what applies to it, and a real task none", () => {
    const occurrence = n("habititem-flow_task-2-1-0-virtual", "task", {
      status: "todo",
      virtual: true,
      habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 4 },
      occurrence: { templateTitle: "Run", ownTitle: null, blockedReason: null, dependsOn: [], deleted: false },
    });
    const real = n("task-9", "task", { status: "todo" });
    setup([occurrence, real], [row({ node: occurrence }), row({ node: real })]);
    render(<ListViewInApp />);

    fireEvent.contextMenu(screen.getByText("task-9"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByText("habititem-flow_task-2-1-0-virtual"));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual([
      "occurrence.edit",
      "occurrence.status.in_progress",
      "occurrence.status.done",
      "occurrence.plan",
      "occurrence.unplan",
      "occurrence.delete",
    ]);
  });

  it("deletes a Habit occurrence from its iteration alone, without the row delete's confirmation", async () => {
    const occurrence = n("habititem-flow_task-2-1-0-virtual", "task", {
      status: "todo",
      virtual: true,
      habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 4 },
    });
    const { removeNode } = setup([occurrence], [row({ node: occurrence })]);
    render(<ListViewInApp />);
    deleteRow("habititem-flow_task-2-1-0-virtual");
    expect(screen.queryByText("warnings:deleteHeading")).not.toBeInTheDocument();
    expect(removeNode).not.toHaveBeenCalled();
    await waitFor(() => expect(setHabitInstanceDeleted).toHaveBeenCalledWith(
      { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 4 }, true,
    ));
    await waitFor(() => expect(useMindmapStore.getState().pendingToast).not.toBeNull());
  });

  describe("where the selection lands", () => {
    /** The card the list is currently standing on. */
    function selectedTitle(container: HTMLElement): string | undefined {
      return container.querySelector("[class*='cardSelected']")?.textContent ?? undefined;
    }

    it("moves to the row below the one that went", async () => {
      twoSiblings();
      const { container } = render(<ListViewInApp />);
      deleteRow("task-a");
      await confirm();
      expect(selectedTitle(container)).toContain("task-b");
    });

    it("moves to the row above when the deleted one was last", async () => {
      twoSiblings();
      const { container } = render(<ListViewInApp />);
      deleteRow("task-b");
      await confirm();
      expect(selectedTitle(container)).toContain("task-a");
    });

    // The row below may be a child that is going with it, which would leave the selection on a row
    // that no longer exists.
    it("skips the rows that went with it", async () => {
      setup(
        [taskA([childOfA()]), taskB()],
        [
          row({ node: taskA([childOfA()]) }),
          row({
            node: childOfA(),
            ancestors: [n("aspect-1", "aspect"), n("goal-1", "goal", { status: "active" }), taskA()],
          }),
          row({ node: taskB() }),
        ],
      );
      const { container } = render(<ListViewInApp />);
      deleteRow("task-a");
      await confirm();
      expect(selectedTitle(container)).toContain("task-b");
    });

    it("clears the selection when the list had nothing else in it", async () => {
      setup([taskA()], [row({ node: taskA() })]);
      const { container } = render(<ListViewInApp />);
      deleteRow("task-a");
      await confirm();
      expect(container.querySelector("[class*='cardSelected']")).toBeNull();
    });
  });
});
