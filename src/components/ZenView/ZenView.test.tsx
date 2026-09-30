import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import ZenView from "./ZenView";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import { fixtureRowId } from "@/test/node-fixture";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useListData } from "@/hooks/use-list-data";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-list-data");
const openEditor = vi.fn();
vi.mock("@/components/MindmapView/use-node-editor", () => ({
  useNodeEditor: () => ({
    editorModal: null,
    setEditorModal: vi.fn(),
    allTags: [],
    domainNames: new Map(),
    availableForDep: [],
    onDoubleClick: (id: string) => openEditor(id),
  }),
}));
vi.mock("@/components/NodeEditorModals/NodeEditorModals", () => ({ default: () => null }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

/** The Zen View as the app mounts it: its own table and the global one. */
function ZenViewInApp() {
  useGlobalHotkeys();
  return <ZenView />;
}

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

const onCycleStatus = vi.fn();
const onToggleStarted = vi.fn();
const toggleRelease = vi.fn();
const createTask = vi.fn(() => Promise.resolve(n("task-99", "task")));

function mockBoard(children: MindmapNode[]): void {
  const tree = { ...n("root", "domain", { title: "Arlesh" }), children };
  vi.mocked(useListData).mockReturnValue({
    tree,
    rows: flattenTaskRows(tree, []),
    commitmentRows: flattenCommitmentRows(tree),
    expectationRows: flattenExpectationRows(tree),
    listRoot: tree,
    toggleRelease,
    allTasksAndGoals: [],
    isLoading: false,
    error: null,
    reload: vi.fn(() => Promise.resolve()),
    onCycleStatus,
    onToggleStarted,
    renameNode: vi.fn(() => Promise.resolve()),
    createTask,
    deleteTask: vi.fn(() => Promise.resolve()),
    removeNode: vi.fn(() => Promise.resolve()),
    occurrencePrompt: null,
    confirmOccurrence: vi.fn(),
    cancelOccurrence: vi.fn(),
  });
}

/** Four in-progress Tasks under a Goal, beside what the strips hold and what nothing shows. */
function standardBoard(): MindmapNode[] {
  return [
    n("goal-1", "goal", {
      title: "Growth",
      status: "active",
      children: [
        n("task-1", "task", { title: "Write the spec", status: "in_progress" }),
        n("task-2", "task", { title: "לכתוב את הקוד", status: "in_progress" }),
        n("task-3", "task", { title: "Not started", status: "todo" }),
        n("task-4", "task", { title: "Review", status: "in_progress", asynchronous: true }),
        n("task-5", "task", { title: "Ship", status: "in_progress", overdue: true }),
      ],
    }),
    n("commitment-1", "commitment", { title: "Call home", verdict: "unresolved" }),
    n("commitment-2", "commitment", { title: "Kept already", verdict: "kept" }),
    n("expectation-1", "expectation", { title: "Waiting on CI", status: "pending" }),
    n("expectation-2", "expectation", { title: "Next week", status: "pending", timing: "pending" }),
  ];
}

function taskCards(): string[] {
  return [...document.querySelectorAll('[data-zen-card="task"]')].map((el) => el.getAttribute("data-row-id") ?? "");
}

function selectedCard(): string | null {
  return document.querySelector('[data-zen-card][aria-current="true"]')?.getAttribute("data-row-id") ?? null;
}

function press(code: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  act(() => { fireEvent.keyDown(window, { code, ...modifiers }); });
}

/** Gives every element a layout box of this size, so the grid has an area to fit. */
function withArea(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "all" } });
  useMindmapStore.setState({ subtreeRootId: null, pendingToast: null, searchOpen: false });
  useViewStore.setState({ view: "zen", zenCommitments: true, zenExpectations: true });
  useDisplayStore.setState({ zenShowBadges: true, zenShowOverdueBorder: true, startHidesCheckedWaits: false, zenShowsStarted: false, doShowsStarted: false });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  mockBoard(standardBoard());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what the Zen View draws", () => {
  it("shows the in-progress Tasks as cards in board order, whatever the tab's preset, and leaves the preset alone", () => {
    render(<ZenViewInApp />);
    expect(taskCards()).toEqual(["task-1", "task-2", "task-4", "task-5"]);
    expect(useFilterStore.getState().filter.statusMode).toBe("all");
  });

  it("gives each card its title and, beneath it, the path to it; a Hebrew title runs in its own direction", () => {
    render(<ZenViewInApp />);
    const card = document.querySelector('[data-row-id="task-2"]');
    if (!(card instanceof HTMLElement)) throw new Error("no card for task-2");
    const title = within(card).getByText("לכתוב את הקוד");
    expect(title).toHaveAttribute("dir", "auto");
    expect(within(card).getByText("Growth")).toBeInTheDocument();
  });

  it("draws the unresolved Commitments and the open Expectations in their strips", () => {
    render(<ZenViewInApp />);
    const commitments = screen.getByRole("region", { name: "zenView:commitmentsStrip" });
    const expectations = screen.getByRole("region", { name: "zenView:expectationsStrip" });
    expect(within(commitments).getByText("Call home")).toBeInTheDocument();
    expect(within(commitments).queryByText("Kept already")).not.toBeInTheDocument();
    expect(within(expectations).getByText("Waiting on CI")).toBeInTheDocument();
    expect(within(expectations).queryByText("Next week")).not.toBeInTheDocument();
  });

  it("takes no room for a strip with nothing in it", () => {
    mockBoard([n("task-1", "task", { status: "in_progress" })]);
    render(<ZenViewInApp />);
    expect(screen.queryByRole("region", { name: "zenView:commitmentsStrip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "zenView:expectationsStrip" })).not.toBeInTheDocument();
  });

  it("leaves a Started Task off the grid by default, and shows it with its own setting, not Do's", () => {
    mockBoard([n("task-1", "task", { status: "in_progress" }), n("task-2", "task", { status: "started" })]);
    useDisplayStore.setState({ doShowsStarted: true });
    const { unmount } = render(<ZenViewInApp />);
    expect(taskCards()).toEqual(["task-1"]);
    unmount();
    useDisplayStore.setState({ doShowsStarted: false, zenShowsStarted: true });
    render(<ZenViewInApp />);
    expect(taskCards()).toEqual(["task-1", "task-2"]);
  });

  it("draws the status icon in a card's badge row for every status but In Progress", () => {
    mockBoard([n("task-1", "task", { status: "in_progress" }), n("task-2", "task", { status: "started" })]);
    useDisplayStore.setState({ zenShowsStarted: true });
    withArea(1200, 800);
    render(<ZenViewInApp />);
    const icons = [...document.querySelectorAll("[data-zen-status-icon]")];
    expect(icons.map((icon) => icon.closest("[data-row-id]")?.getAttribute("data-row-id"))).toEqual(["task-2"]);
    expect(icons[0]?.getAttribute("data-zen-status-icon")).toBe("started");
  });

  it("says so when nothing is in progress", () => {
    mockBoard([n("task-1", "task", { status: "todo" })]);
    render(<ZenViewInApp />);
    expect(screen.getByText("zenView:empty")).toBeInTheDocument();
  });
});

describe("the tab's own switches", () => {
  it("draws no strip the tab has switched off (from the Filter menu)", () => {
    useViewStore.setState({ zenCommitments: false });
    render(<ZenViewInApp />);
    expect(screen.queryByRole("region", { name: "zenView:commitmentsStrip" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "zenView:expectationsStrip" })).toBeInTheDocument();
  });

  it("narrows the grid by the Agentic pill", () => {
    mockBoard([
      n("task-1", "task", { status: "in_progress", agentic: true }),
      n("task-2", "task", { status: "in_progress" }),
    ]);
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [{ value: "agentic", mode: "all" }] } },
    });
    render(<ZenViewInApp />);
    expect(taskCards()).toEqual(["task-1"]);
  });

  it("does not toggle a strip on Alt+E, which is the List View's Expectations option: it says Zen reads under Do", () => {
    render(<ZenViewInApp />);
    press("KeyE", { altKey: true });
    expect(screen.getByRole("region", { name: "zenView:expectationsStrip" })).toBeInTheDocument();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("zenView:presetLocked");
  });
});

describe("the badge row", () => {
  it("is drawn on a card tall enough, and not with the setting off", () => {
    withArea(1200, 800);
    const { unmount } = render(<ZenViewInApp />);
    const review = document.querySelector('[data-row-id="task-4"]');
    if (!(review instanceof HTMLElement)) throw new Error("no card for task-4");
    expect(within(review).getByRole("group", { name: "row" })).toBeInTheDocument();
    unmount();

    useDisplayStore.setState({ zenShowBadges: false });
    render(<ZenViewInApp />);
    expect(screen.queryByRole("group", { name: "row" })).not.toBeInTheDocument();
  });

  it("is not drawn on a minimum-size card", () => {
    render(<ZenViewInApp />);
    expect(screen.queryByRole("group", { name: "row" })).not.toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it("moves across and down the grid in two dimensions", () => {
    // 4 cards in 1000×400 fit best two to a row.
    withArea(1000, 400);
    render(<ZenViewInApp />);
    press("ArrowRight");
    expect(selectedCard()).toBe("task-1");
    press("ArrowRight");
    expect(selectedCard()).toBe("task-2");
    press("ArrowDown");
    expect(selectedCard()).toBe("task-5");
    press("ArrowLeft");
    expect(selectedCard()).toBe("task-4");
  });

  it("goes up from the grid into the Expectations strip, then the Commitments strip, and back down", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    expect(selectedCard()).toBe("task-1");
    press("ArrowUp");
    expect(selectedCard()).toBe("expectation-1");
    press("ArrowUp");
    expect(selectedCard()).toBe("commitment-1");
    press("ArrowDown");
    press("ArrowDown");
    expect(selectedCard()).toBe("task-1");
  });

  it("selects on click and opens the editor on a double click", () => {
    render(<ZenViewInApp />);
    const card = document.querySelector('[data-row-id="task-5"]');
    if (!(card instanceof HTMLElement)) throw new Error("no card for task-5");
    fireEvent.click(card);
    expect(selectedCard()).toBe("task-5");
    fireEvent.doubleClick(card);
    expect(openEditor).toHaveBeenCalledWith("task-5");
  });

  it("cycles the selected Task with Enter, and releases the selected wait", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    press("Enter");
    expect(onCycleStatus).toHaveBeenCalledWith("task-1");

    press("ArrowUp");
    press("Enter");
    expect(toggleRelease).toHaveBeenCalledWith("expectation-1");
  });

  it("sets the selected Task Started with Alt+Enter", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    press("Enter", { altKey: true });
    expect(onToggleStarted).toHaveBeenCalledWith("task-1");
    expect(onCycleStatus).not.toHaveBeenCalled();
  });

  it("keeps a card your own edit stops matching on screen, dimmed and iconed, until the selection moves", () => {
    withArea(1200, 800);
    const { rerender } = render(<ZenViewInApp />);
    press("ArrowDown");
    expect(selectedCard()).toBe("task-1");

    // The write lands and the board reloads with task-1 Done: it no longer matches Do.
    const board = standardBoard();
    const goal = board[0];
    if (goal === undefined) throw new Error("no goal");
    goal.children = goal.children.map((child) => (child.id === "task-1" ? { ...child, status: "done" } : child));
    mockBoard(board);
    rerender(<ZenViewInApp />);

    expect(taskCards()).toContain("task-1");
    const card = document.querySelector('[data-row-id="task-1"]');
    expect(card?.className).toMatch(/cardFocusExempt/);
    expect(card?.querySelector("[data-zen-status-icon]")?.getAttribute("data-zen-status-icon")).toBe("done");
    expect(selectedCard()).toBe("task-1");

    press("ArrowRight");
    expect(taskCards()).not.toContain("task-1");
  });

  it("opens the editor with E", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    press("KeyE");
    expect(openEditor).toHaveBeenCalledWith("task-1");
  });

  it("jumps to the first and last card with Ctrl+Home and Ctrl+End", () => {
    render(<ZenViewInApp />);
    press("End", { ctrlKey: true });
    expect(selectedCard()).toBe("task-5");
    press("Home", { ctrlKey: true });
    expect(selectedCard()).toBe("commitment-1");
  });

  it("creates nothing: the List View's create keys do nothing here", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    press("Tab");
    press("Enter", { shiftKey: true });
    press("KeyE", { shiftKey: true });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("says the preset cannot change rather than changing it", () => {
    render(<ZenViewInApp />);
    press("KeyA", { altKey: true });
    expect(useMindmapStore.getState().pendingToast?.message).toBe("zenView:presetLocked");
    expect(useFilterStore.getState().filter.statusMode).toBe("all");
  });

  it("asks before deleting the selected card", () => {
    render(<ZenViewInApp />);
    press("ArrowDown");
    press("Delete");
    expect(screen.getByText("warnings:deleteHeading")).toBeInTheDocument();
  });

  it("is shown by Ctrl+J from another view", () => {
    useViewStore.setState({ view: "list" });
    render(<ZenViewInApp />);
    press("KeyJ", { ctrlKey: true });
    expect(useViewStore.getState().view).toBe("zen");
  });
});

describe("the overdue border", () => {
  function zenCard(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-zen-card="task"][data-row-id="${id}"]`);
    if (element === null) throw new Error(`no card for ${id}`);
    return element;
  }

  it("is drawn on an Overdue card, and says Overdue in its description", () => {
    render(<ZenViewInApp />);
    expect(zenCard("task-5").className).toMatch(/cardOverdue/);
    expect(zenCard("task-5")).toHaveAccessibleDescription("overdue");
    expect(zenCard("task-1").className).not.toMatch(/cardOverdue/);
  });

  it("is not drawn with the setting off, though the card still says Overdue", () => {
    useDisplayStore.setState({ zenShowOverdueBorder: false });
    render(<ZenViewInApp />);
    expect(zenCard("task-5").className).not.toMatch(/cardOverdue/);
    expect(zenCard("task-5")).toHaveAccessibleDescription("overdue");
  });

  it("gives a selected Overdue card both classes, so its selection takes the selected-and-Overdue colour", () => {
    render(<ZenViewInApp />);
    act(() => { fireEvent.click(zenCard("task-5")); });
    expect(selectedCard()).toBe("task-5");
    expect(zenCard("task-5").className).toMatch(/cardOverdue/);
    expect(zenCard("task-5").className).toMatch(/cardSelected/);
  });
});
