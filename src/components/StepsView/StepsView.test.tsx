import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StepsView from "./StepsView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/MindmapView/use-mindmap-data");
vi.mock("@/components/NodeEditorModals/NodeEditorModals", () => ({
  default: () => <div data-testid="editor-modals" />,
}));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

const setEditorModal = vi.fn();
vi.mock("@/components/MindmapView/use-node-editor", () => ({
  useNodeEditor: () => ({
    editorModal: null,
    setEditorModal: (value: unknown) => setEditorModal(value),
    allTags: [],
    domainNames: new Map(),
    availableForDep: [],
  }),
}));

const updateTask = vi.fn((_id: number, _request: unknown) => Promise.resolve());

const undo = vi.fn(() => Promise.resolve(null));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  undo: () => undo(),
}));
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: number, request: unknown) => updateTask(id, request),
}));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

const reload = vi.fn(() => Promise.resolve());
const createChild = vi.fn((_parentId: string, _parentKind: NodeKind, _title: string) =>
  Promise.resolve(n("task-99", "task")));
const createNode = vi.fn((_parentId: string, _parentKind: NodeKind, childKind: NodeKind, _title: string) =>
  Promise.resolve(n(`${childKind}-98`, childKind)));
const removeNode = vi.fn((_nodes: Array<{ id: string; kind: NodeKind }>) => Promise.resolve());

function mockTree(children: MindmapNode[]): void {
  vi.mocked(useMindmapData).mockReturnValue({
    tree: { ...n("root", "domain", { title: "Arlesh" }), children },
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    reload,
    createNode,
    createChild,
    renameNode: vi.fn(),
    retypeNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    removeNode,
    createCommitment: vi.fn(),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
  });
}

/** The cards on the Step, in the order they are drawn — the header card first. */
function cardIds(): string[] {
  return [...document.querySelectorAll("[data-step-card]")]
    .map((el) => el.getAttribute("data-step-card") ?? "");
}

/** The id of the card the cursor is on, or `null`. */
function selectedCardId(): string | null {
  const selected = document.querySelector('[data-step-card][aria-current="true"]');
  return selected === null ? null : selected.getAttribute("data-step-card");
}

function press(code: string): void {
  act(() => { fireEvent.keyDown(window, { code }); });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useMindmapStore.setState({
    subtreeRootId: null, pendingToast: null, searchOpen: false,
    selectedNodeId: null, selectedNodeIds: new Set(),
  });
  useViewStore.setState({ stepsZoom: 3 });
});

describe("a Step", () => {
  it("draws the board as the header card at the true root, and its children as cards", () => {
    mockTree([n("domain-1", "domain"), n("domain-2", "domain")]);
    render(<StepsView />);
    expect(cardIds()).toEqual(["board", "domain-1", "domain-2"]);
  });

  it("draws the node you are standing on as the header card, and nothing deeper than its children", () => {
    const grandchild = n("task-2", "task");
    const child = n("task-1", "task", { children: [grandchild] });
    mockTree([n("goal-1", "goal", { children: [child] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);
    expect(cardIds()).toEqual(["goal-1", "task-1"]);
  });

  it("counts what descending will show against what the board holds, so the filter's effect shows", () => {
    // Standing on the Goal: one of its two Tasks survives the Do preset, so the header card counts
    // "1 of 2" while the surviving Task, which holds nothing, reads as empty.
    const shown = n("task-1", "task", { status: "in_progress" });
    const hidden = n("task-2", "task", { status: "done" });
    mockTree([n("goal-1", "goal", { status: "active", children: [shown, hidden] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    render(<StepsView />);

    expect(cardIds()).toEqual(["goal-1", "task-1"]);
    expect(screen.getAllByText("stepsView:childCount")).toHaveLength(1);
    expect(screen.getAllByText("stepsView:childCountEmpty")).toHaveLength(1);
  });
});

describe("walking down", () => {
  it("moves the tab's shared subtree root, so every view lands where you walked", () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe("goal-1");
    press("Enter");

    expect(useMindmapStore.getState().subtreeRootId).toBe("goal-1");
  });

  it("opens an empty Step on a childless Task, rather than refusing to enter a leaf", () => {
    mockTree([n("task-1", "task")]);
    render(<StepsView />);

    press("ArrowDown");
    press("Enter");

    expect(useMindmapStore.getState().subtreeRootId).toBe("task-1");
  });

  it("refuses a folded run of Habit history out loud — a drawing has no inside", () => {
    mockTree([n("habitrun-1-virtual", "habit_group", {
      habitGroup: {
        flowId: 1, level: "run", passed: 9, done: 5, missed: 4,
        spanStart: "2026-01-01", spanEnd: "2026-02-01", spanLabel: "January",
      },
    })]);
    render(<StepsView />);

    press("ArrowDown");
    press("Enter");

    expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedNotStored");
  });

  it("says so rather than doing nothing when Enter lands on the card you are standing on", () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    press("ArrowUp");
    expect(selectedCardId()).toBe("goal-1");
    press("Enter");

    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedAlreadyHere");
  });

  it("refuses every node gesture on the board's own header card, out loud", () => {
    mockTree([n("domain-1", "domain")]);
    render(<StepsView />);

    press("ArrowUp");
    expect(selectedCardId()).toBe("board");
    press("KeyE");

    expect(setEditorModal).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });
});

describe("the arrow grid", () => {
  it("starts on the first child going down and on the header going up", () => {
    mockTree([n("domain-1", "domain"), n("domain-2", "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe("domain-1");

    press("ArrowUp");
    expect(selectedCardId()).toBe("board");
  });

  it("keeps the selection Steps' own — it is never written into the shared store", () => {
    mockTree([n("domain-1", "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe("domain-1");
    expect(useMindmapStore.getState().selectedNodeId).toBeNull();
  });

  it("clears the selection on Escape", () => {
    mockTree([n("domain-1", "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    press("Escape");
    expect(selectedCardId()).toBeNull();
  });
});

describe("a card with no editor", () => {
  // The bug this pins: opening an editor on a kind that has none set the modal open on nothing.
  // `NodeEditorModals` drew null, so there was no modal on screen — and the view gates its whole
  // keyboard on `editorModal !== null`, so every Steps binding went dead with no way back.
  it("refuses an Aspect out loud, and leaves the keyboard alive", () => {
    mockTree([n("domain-1", "aspect"), n("domain-2", "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe("domain-1");
    press("KeyE");

    expect(setEditorModal).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedNoEditor");

    // The proof it is not wedged: the next keystroke still moves.
    press("ArrowRight");
    expect(selectedCardId()).toBe("domain-2");
  });

  it("refuses a virtual Habit occurrence, which is drawn from its template rather than stored", () => {
    mockTree([n("task-7", "task", {
      virtual: true,
      habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 0 },
    })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyE");

    expect(setEditorModal).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedNoEditor");
  });
});

describe("a card's colour", () => {
  /** The `--card-aspect` a card was given, or null when it was given none. */
  function aspectOf(id: string): string | null {
    const card = document.querySelector(`[data-step-card="${id}"]`);
    if (!(card instanceof HTMLElement)) throw new Error(`no card ${id}`);
    const value = card.style.getPropertyValue("--card-aspect");
    return value === "" ? null : value;
  }

  it("is its aspect's, taken from the node itself at the root where each card is an aspect", () => {
    mockTree([
      n("domain-1", "aspect", { color: "#e74c3c" }),
      n("domain-2", "aspect", { color: "#27ae60" }),
    ]);
    render(<StepsView />);

    expect(aspectOf("domain-1")).toBe("#e74c3c");
    expect(aspectOf("domain-2")).toBe("#27ae60");
  });

  it("is the Step's aspect for a child that carries no colour of its own", () => {
    mockTree([n("domain-1", "aspect", {
      color: "#2980b9",
      children: [n("task-1", "task")],
    })]);
    useMindmapStore.setState({ subtreeRootId: "domain-1" });
    render(<StepsView />);

    expect(aspectOf("domain-1")).toBe("#2980b9");
    expect(aspectOf("task-1")).toBe("#2980b9");
  });

  it("says nothing about state — the glyph and the badges carry that", () => {
    // Two Tasks in one aspect, one blocked and one done: same fill, different glyphs. This is the
    // trade the aspect colouring makes, and it is only safe because the icon already draws status.
    mockTree([n("domain-1", "aspect", {
      color: "#9b59b6",
      children: [
        n("task-1", "task", { status: "done" }),
        n("task-2", "task", { status: "todo", virtualBlockers: ["Blocked by Spec"] }),
      ],
    })]);
    useMindmapStore.setState({ subtreeRootId: "domain-1" });
    render(<StepsView />);

    expect(aspectOf("task-1")).toBe("#9b59b6");
    expect(aspectOf("task-2")).toBe("#9b59b6");
  });

  it("leaves a card outside any aspect the theme's own background", () => {
    mockTree([n("domain-1", "domain")]);
    render(<StepsView />);
    expect(aspectOf("domain-1")).toBeNull();
  });
});

describe("a card's glyph and kind line", () => {
  it("draws an Aspect with neither a glyph, nor an empty slot for one, nor its kind in words", () => {
    mockTree([n("domain-1", "aspect", { color: "#e74c3c" }), n("domain-2", "domain")]);
    render(<StepsView />);

    const aspect = document.querySelector('[data-step-card="domain-1"]');
    expect(aspect?.querySelector("svg")).toBeNull();
    expect(aspect?.textContent).not.toContain("nodeKinds:aspect");
    expect(document.querySelector('[data-step-card="domain-2"] svg')).not.toBeNull();
  });

  it("writes out the kind only where the glyph is borrowed — a Flow's template Task", () => {
    mockTree([n("task-1", "task"), n("flow_task-2", "flow_task")]);
    render(<StepsView />);

    expect(document.querySelector('[data-step-card="task-1"]')?.textContent).not.toContain("nodeKinds:task");
    expect(document.querySelector('[data-step-card="flow_task-2"]')?.textContent).toContain("nodeKinds:flow_task");
  });
});

describe("the Info notes on a card", () => {
  it("draws the first ones as bullets", () => {
    mockTree([n("goal-1", "goal", {
      children: [n("info-1", "info", { title: "watch the migration" })],
    })]);
    render(<StepsView />);

    expect(screen.getByText("watch the migration")).toBeTruthy();
  });

  it("says what it had no room for rather than dropping it in silence", () => {
    // The smallest card, with more notes than any card could hold.
    useViewStore.setState({ stepsZoom: 1 });
    const notes = Array.from({ length: 12 }, (_, i) => n(`info-${i}`, "info", { title: `note ${i}` }));
    mockTree([n("goal-1", "goal", { children: notes })]);
    render(<StepsView />);

    expect(screen.getByText("stepsView:moreNotes")).toBeTruthy();
  });
});

describe("acting on the selected card", () => {
  it("cycles a Task's status on Space", () => {
    mockTree([n("task-1", "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("Space");

    expect(updateTask).toHaveBeenCalledWith(1, { status: "in_progress" });
  });

  it("opens the editor on E", () => {
    mockTree([n("task-1", "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyE");

    expect(setEditorModal).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-1" }));
  });
});

describe("an empty Step", () => {
  it("offers to create the first child, and opens its editor to be named", async () => {
    mockTree([n("task-1", "task")]);
    useMindmapStore.setState({ subtreeRootId: "task-1" });
    render(<StepsView />);

    expect(screen.getByText("stepsView:emptyStep")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("stepsView:createFirstChild"));
    });

    expect(createChild).toHaveBeenCalledWith("task-1", "task", "");
    expect(setEditorModal).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-99" }));
  });

  it("says the filter emptied it, rather than offering a child it already has", () => {
    mockTree([n("goal-1", "goal", { status: "active", children: [n("task-1", "task", { status: "done" })] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    render(<StepsView />);

    expect(screen.getByText("stepsView:emptyStepFiltered")).toBeTruthy();
    expect(screen.queryByText("stepsView:createFirstChild")).toBeNull();
  });
});

function pressWith(code: string, modifiers: { shift?: boolean; ctrl?: boolean }): void {
  act(() => { fireEvent.keyDown(window, { code, shiftKey: modifiers.shift ?? false, ctrlKey: modifiers.ctrl ?? false }); });
}

/** Lets the shared action's create/delete promise settle, and re-renders on what it set. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

/** Selects the first card below the header. */
function selectFirstCard(): void {
  press("ArrowDown");
}

describe("creating from a Step", () => {
  it("puts a sibling of the selected card on this Step, selected and open for naming", async () => {
    const goal = n("goal-1", "goal", { children: [n("task-1", "task"), n("task-2", "task")] });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    const { rerender } = render(<StepsView />);

    selectFirstCard();
    pressWith("Enter", { shift: true });
    await settle();

    // The Mindmap's own sibling action: a node of the same kind, under the Step, carrying the
    // source's own Agentic answer ("inherit" when it gave none).
    expect(createNode).toHaveBeenCalledWith("goal-1", "goal", "task", "", "inherit");
    // The reload is simulated by the tree now holding the new card.
    mockTree([{ ...goal, children: [...goal.children, n("task-98", "task")] }]);
    rerender(<StepsView />);
    expect(selectedCardId()).toBe("task-98");
    expect(screen.getByLabelText("stepsView:titleLabel")).toBeTruthy();
  });

  it("makes a child of the header card a card on this Step, without moving", async () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    press("ArrowUp"); // onto the header
    press("ArrowDown");
    press("ArrowUp");
    press("Tab");
    await settle();

    expect(createChild).toHaveBeenCalledWith("goal-1", "goal", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe("goal-1");
  });

  it("steps into a card when the new node is its child, as the Mindmap puts it under that card", async () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    selectFirstCard();
    press("Tab");
    await settle();

    expect(createChild).toHaveBeenCalledWith("task-1", "task", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe("task-1");
  });

  it("does not step in when the create is refused, and says why", async () => {
    // A Tag holds notes and nothing else, so Tab (which would create its default child) is refused.
    mockTree([n("domain-1", "domain", { children: [n("domain-2", "tag")] })]);
    useMindmapStore.setState({ subtreeRootId: "domain-1" });
    render(<StepsView />);

    selectFirstCard();
    press("Tab");
    await settle();

    expect(createChild).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().subtreeRootId).toBe("domain-1");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:createUnderTagRefused");
  });

  it("refuses a sibling of the Step itself, which would land outside it", () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowUp");
    pressWith("Enter", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedSiblingOfStep");
  });

  it("refuses every create on the board's own card, out loud", () => {
    mockTree([n("domain-1", "aspect")]);
    render(<StepsView />);

    selectFirstCard();
    press("ArrowUp"); // the board
    press("Tab");

    expect(createChild).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });
});

describe("deleting from a Step", () => {
  it("asks first, deletes the card's subtree, and lands on the next card", async () => {
    const goal = n("goal-1", "goal", {
      children: [n("task-1", "task", { children: [n("task-3", "task")] }), n("task-2", "task")],
    });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    selectFirstCard();
    press("Delete");
    expect(removeNode).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByText("warnings:deleteConfirm")); });

    expect(removeNode).toHaveBeenCalledWith([
      { id: "task-3", kind: "task" }, { id: "task-1", kind: "task" },
    ]);
    expect(selectedCardId()).toBe("task-2");
  });

  it("lands on the card before when the last one goes", async () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task"), n("task-2", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowRight");
    press("Delete");
    await act(async () => { fireEvent.click(screen.getByText("warnings:deleteConfirm")); });

    expect(selectedCardId()).toBe("task-1");
  });

  it("refuses the Step you are standing on", () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowUp");
    press("Delete");

    expect(screen.queryByText("warnings:deleteConfirm")).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedDeleteStep");
  });

  it("refuses an Aspect, as the Mindmap does", () => {
    mockTree([n("domain-1", "aspect")]);
    render(<StepsView />);
    selectFirstCard();
    press("Delete");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:deleteAspectRefused");
  });

  it("refuses a Habit repetition, which is drawn rather than stored, as the Mindmap does", () => {
    mockTree([n("goal-1", "goal", { children: [n("task-5", "task", { virtual: true })] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);
    selectFirstCard();
    press("Delete");
    expect(screen.queryByText("warnings:deleteConfirm")).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:deleteRepetitionRefused");
  });

  it("refuses the board's own card", () => {
    mockTree([n("domain-1", "aspect")]);
    render(<StepsView />);
    selectFirstCard();
    press("ArrowUp");
    press("Delete");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });
});

describe("undoing from a Step", () => {
  it("takes a create back with one Ctrl+Z", async () => {
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task")] })]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    const { rerender } = render(<StepsView />);

    selectFirstCard();
    pressWith("Enter", { shift: true });
    await settle();
    mockTree([n("goal-1", "goal", { children: [n("task-1", "task"), n("task-98", "task")] })]);
    rerender(<StepsView />);
    // The new card's title is open; leaving it closes the rename without a write.
    act(() => { fireEvent.keyDown(screen.getByLabelText("stepsView:titleLabel"), { key: "Escape" }); });
    pressWith("KeyZ", { ctrl: true });
    await settle();

    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe("Shift+initial with nothing selected", () => {
  it("creates that kind on the current Step, selected and open for naming", async () => {
    const goal = n("goal-1", "goal", { children: [n("task-1", "task")] });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    const { rerender } = render(<StepsView />);

    expect(selectedCardId()).toBeNull();
    pressWith("KeyT", { shift: true });
    await settle();

    expect(createNode).toHaveBeenCalledWith("goal-1", "goal", "task", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe("goal-1");
    mockTree([{ ...goal, children: [...goal.children, n("task-98", "task")] }]);
    rerender(<StepsView />);
    expect(selectedCardId()).toBe("task-98");
    expect(screen.getByLabelText("stepsView:titleLabel")).toBeTruthy();
  });

  it("refuses out loud at the board, where nothing can be created", () => {
    mockTree([n("domain-1", "aspect")]);
    render(<StepsView />);

    pressWith("KeyD", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });

  it("refuses a kind the Step cannot hold, in the Mindmap's words", () => {
    mockTree([n("goal-1", "goal")]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    pressWith("KeyP", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:typedChildRefused");
  });

  it("does nothing while a text field has focus — the letter is typed, not a command", () => {
    mockTree([n("goal-1", "goal")]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<><StepsView /><input aria-label="elsewhere" /></>);

    const field = screen.getByLabelText("elsewhere");
    field.focus();
    act(() => { fireEvent.keyDown(field, { code: "KeyT", shiftKey: true }); });

    expect(createNode).not.toHaveBeenCalled();
  });
});

describe("the Step's +", () => {
  it("is not offered on the board, where nothing can be created", () => {
    mockTree([n("domain-1", "aspect")]);
    render(<StepsView />);
    expect(screen.queryByLabelText("stepsView:addToStep")).toBeNull();
  });

  it("offers only the kinds the Step can hold, each with its chord", () => {
    mockTree([n("goal-1", "goal")]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    fireEvent.click(screen.getByRole("button", { name: "stepsView:addToStep" }));

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toContain("nodeKinds:taskShift+T");
    expect(items.some((item) => item?.startsWith("nodeKinds:project") === true)).toBe(false);
  });

  it("creates the chosen kind on the Step, as its chord would", async () => {
    mockTree([n("goal-1", "goal")]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);

    fireEvent.click(screen.getByRole("button", { name: "stepsView:addToStep" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /nodeKinds:task/ }));
    await settle();

    expect(createNode).toHaveBeenCalledWith("goal-1", "goal", "task", "");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is driven from the keyboard: arrows move, Enter picks, Escape closes", async () => {
    mockTree([n("goal-1", "goal")]);
    useMindmapStore.setState({ subtreeRootId: "goal-1" });
    render(<StepsView />);
    const trigger = screen.getByRole("button", { name: "stepsView:addToStep" });

    fireEvent.click(trigger);
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const first = screen.getAllByRole("menuitem")[0]?.textContent ?? "";
    const second = screen.getAllByRole("menuitem")[1]?.textContent ?? "";
    expect(first).not.toBe(second);
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    act(() => { fireEvent.keyDown(window, { key: "Enter" }); });
    await settle();

    // The second kind offered to a Goal, whatever it is, was created under the Step.
    expect(createNode.mock.calls[0]?.[0]).toBe("goal-1");
    expect(`nodeKinds:${createNode.mock.calls[0]?.[2] ?? ""}`).toBe(second.replace(/Shift\+.$/, ""));
  });
});
