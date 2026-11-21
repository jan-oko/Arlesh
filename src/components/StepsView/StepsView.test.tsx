import { storedRowId } from "@/test/stored-id";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import StepsView from "./StepsView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { fixtureRowId } from "@/test/node-fixture";
import { ordinary } from "@/utils/status-mapping";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/MindmapView/use-mindmap-data");
vi.mock("@/components/NodeEditorModals/NodeEditorModals", () => ({
  default: () => <div data-testid="editor-modals" />,
}));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
// The blank Flow editor (Shift+H) asks the backend which targets could hold it; unrestricted here.
vi.mock("@/hooks/use-valid-flow-targets", () => ({ useValidFlowTargets: () => null }));
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

const updateTask = vi.fn((_id: string, _request: unknown) => Promise.resolve());
const stepTaskStatus = vi.fn((_id: string, _step: string) => Promise.resolve({ outcome: "written", backlog_cleared: null }));
const addTaskDependency = vi.fn((_id: string, _dependency: unknown) => Promise.resolve());
const listAllTaskDependencies = vi.fn(() => Promise.resolve([]));
// What the backend offers as prerequisites (`tasks::rules::dependencies::candidates`).
const fetchDependencyCandidates = vi.fn((_id: string) => Promise.resolve([{ type: "expectation", id: storedRowId(7) }]));

const undo = vi.fn(() => Promise.resolve(null));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  undo: () => undo(),
}));
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  stepTaskStatus: (id: string, step: string) => stepTaskStatus(id, step),
}));
// A gesture operation's Plan writes reach the same spy, one `update_task` each.
vi.mock("@/api/multi-node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/multi-node-gestures")>()),
  runGesture: async (_name: string, steps: Array<{ id: string; request: unknown }>) => {
    for (const step of steps) await updateTask(step.id, step.request);
    return steps.map((step) => ({ id: step.id }));
  },
}));

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: string, request: unknown) => updateTask(id, request),
  addTaskDependency: (id: string, dependency: unknown) => addTaskDependency(id, dependency),
  listAllTaskDependencies: () => listAllTaskDependencies(),
  fetchDependencyCandidates: (id: string) => fetchDependencyCandidates(id),
  // Nothing below the cards holds a Plan of its own, so the clamp prompt has nothing to ask.
  planContainmentConflicts: () => Promise.resolve([]),
}));

/** A fixture node; it draws the row its id names (`task-12` is row 12), unless it is virtual. */
function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  const rowId = extra.virtual === true ? {} : fixtureRowId(id);
  // A stored Task always carries its typed status; the fixture derives it from the spelled one.
  const typed = kind === "task" && extra.status !== undefined && extra.taskStatus === undefined
    ? { taskStatus: ordinary(extra.status === "started" || extra.status === "in_progress" || extra.status === "done" ? extra.status : "todo") }
    : {};
  return { id, ...rowId, kind, title: id, position: 0, tagIds: [], children: [], ...typed, ...extra };
}

const settleBoard = vi.fn(() => Promise.resolve());
const createChild = vi.fn((_parentId: string, _parentKind: NodeKind, _title: string) =>
  Promise.resolve(n(`task-${storedRowId(99)}`, "task")));
const createNode = vi.fn((_parentId: string, _parentKind: NodeKind, childKind: NodeKind, _title: string) =>
  Promise.resolve(n(`${childKind}-${storedRowId(98)}`, childKind)));
const removeNode = vi.fn((_nodes: Array<{ id: string; kind: NodeKind }>) => Promise.resolve());

function mockTree(children: MindmapNode[]): void {
  vi.mocked(useMindmapData).mockReturnValue({
    tree: { ...n("root", "domain", { title: "Arlesh" }), children },
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    settle: settleBoard,
    createNode,
    createChild,
    settleCreated: vi.fn((created: MindmapNode) => Promise.resolve(created)),
    renameNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    pasteNodes: vi.fn().mockResolvedValue([]),
    insertParent: vi.fn().mockResolvedValue(`domain-${storedRowId(99)}`),
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
    mockTree([n(`domain-${storedRowId(1)}`, "domain"), n(`domain-${storedRowId(2)}`, "domain")]);
    render(<StepsView />);
    expect(cardIds()).toEqual(["board", `domain-${storedRowId(1)}`, `domain-${storedRowId(2)}`]);
  });

  it("draws the node you are standing on as the header card, and nothing deeper than its children", () => {
    const grandchild = n(`task-${storedRowId(2)}`, "task");
    const child = n(`task-${storedRowId(1)}`, "task", { children: [grandchild] });
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [child] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);
    expect(cardIds()).toEqual([`goal-${storedRowId(1)}`, `task-${storedRowId(1)}`]);
  });

  it("counts what descending will show against what the board holds, so the filter's effect shows", () => {
    // Standing on the Goal: one of its two Tasks survives the Do preset, so the header card counts
    // "1 of 2" while the surviving Task, which holds nothing, reads as empty.
    const shown = n(`task-${storedRowId(1)}`, "task", { status: "in_progress" });
    const hidden = n(`task-${storedRowId(2)}`, "task", { status: "done" });
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { status: "active", children: [shown, hidden] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    render(<StepsView />);

    expect(cardIds()).toEqual([`goal-${storedRowId(1)}`, `task-${storedRowId(1)}`]);
    expect(screen.getAllByText("stepsView:childCount")).toHaveLength(1);
    expect(screen.getAllByText("stepsView:childCountEmpty")).toHaveLength(1);
  });
});

describe("walking down", () => {
  it("moves the tab's shared subtree root, so every view lands where you walked", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe(`goal-${storedRowId(1)}`);
    press("Enter");

    expect(useMindmapStore.getState().subtreeRootId).toBe(`goal-${storedRowId(1)}`);
  });

  it("opens an empty Step on a childless Task, rather than refusing to enter a leaf", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task")]);
    render(<StepsView />);

    press("ArrowDown");
    press("Enter");

    expect(useMindmapStore.getState().subtreeRootId).toBe(`task-${storedRowId(1)}`);
  });

  it("says so rather than doing nothing when Enter lands on the card you are standing on", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    press("ArrowUp");
    expect(selectedCardId()).toBe(`goal-${storedRowId(1)}`);
    press("Enter");

    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedAlreadyHere");
  });

  it("refuses every node gesture on the board's own header card, out loud", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "domain")]);
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
    mockTree([n(`domain-${storedRowId(1)}`, "domain"), n(`domain-${storedRowId(2)}`, "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe(`domain-${storedRowId(1)}`);

    press("ArrowUp");
    expect(selectedCardId()).toBe("board");
  });

  it("keeps the selection Steps' own — it is never written into the shared store", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe(`domain-${storedRowId(1)}`);
    expect(useMindmapStore.getState().selectedNodeId).toBeNull();
  });

  it("clears the selection on Escape", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "domain")]);
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
    mockTree([n(`domain-${storedRowId(1)}`, "aspect"), n(`domain-${storedRowId(2)}`, "domain")]);
    render(<StepsView />);

    press("ArrowDown");
    expect(selectedCardId()).toBe(`domain-${storedRowId(1)}`);
    press("KeyE");

    expect(setEditorModal).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedNoEditor");

    // The proof it is not wedged: the next keystroke still moves.
    press("ArrowRight");
    expect(selectedCardId()).toBe(`domain-${storedRowId(2)}`);
  });

  it("opens the editor on a Habit occurrence, which is a row like any other", () => {
    mockTree([n(`task-${storedRowId(7)}`, "task", {
      ...occurrenceRow({ habitId: 1, itemType: "flow_task", itemId: 2, cycleId: 0 }),
    })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyE");

    expect(setEditorModal).toHaveBeenCalled();
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
      n(`domain-${storedRowId(1)}`, "aspect", { color: "#e74c3c" }),
      n(`domain-${storedRowId(2)}`, "aspect", { color: "#27ae60" }),
    ]);
    render(<StepsView />);

    expect(aspectOf(`domain-${storedRowId(1)}`)).toBe("#e74c3c");
    expect(aspectOf(`domain-${storedRowId(2)}`)).toBe("#27ae60");
  });

  it("is the Step's aspect for a child that carries no colour of its own", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect", {
      color: "#2980b9",
      children: [n(`task-${storedRowId(1)}`, "task")],
    })]);
    useMindmapStore.setState({ subtreeRootId: `domain-${storedRowId(1)}` });
    render(<StepsView />);

    expect(aspectOf(`domain-${storedRowId(1)}`)).toBe("#2980b9");
    expect(aspectOf(`task-${storedRowId(1)}`)).toBe("#2980b9");
  });

  it("says nothing about state — the glyph and the badges carry that", () => {
    // Two Tasks in one aspect, one blocked and one done: same fill, different glyphs. This is the
    // trade the aspect colouring makes, and it is only safe because the icon already draws status.
    mockTree([n(`domain-${storedRowId(1)}`, "aspect", {
      color: "#9b59b6",
      children: [
        n(`task-${storedRowId(1)}`, "task", { status: "done" }),
        n(`task-${storedRowId(2)}`, "task", { status: "todo", virtualBlockers: ["Blocked by Spec"] }),
      ],
    })]);
    useMindmapStore.setState({ subtreeRootId: `domain-${storedRowId(1)}` });
    render(<StepsView />);

    expect(aspectOf(`task-${storedRowId(1)}`)).toBe("#9b59b6");
    expect(aspectOf(`task-${storedRowId(2)}`)).toBe("#9b59b6");
  });

  it("leaves a card outside any aspect the theme's own background", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "domain")]);
    render(<StepsView />);
    expect(aspectOf(`domain-${storedRowId(1)}`)).toBeNull();
  });
});

describe("a card's glyph and kind line", () => {
  it("draws an Aspect with neither a glyph, nor an empty slot for one, nor its kind in words", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect", { color: "#e74c3c" }), n(`domain-${storedRowId(2)}`, "domain")]);
    render(<StepsView />);

    const aspect = document.querySelector(`[data-step-card="domain-${storedRowId(1)}"]`);
    expect(aspect?.querySelector("svg")).toBeNull();
    expect(aspect?.textContent).not.toContain("nodeKinds:aspect");
    expect(document.querySelector(`[data-step-card="domain-${storedRowId(2)}"] svg`)).not.toBeNull();
  });

  it("writes out the kind only where the glyph is borrowed — a Flow's template Task", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task"), n("flow_task-2", "flow_task")]);
    render(<StepsView />);

    expect(document.querySelector(`[data-step-card="task-${storedRowId(1)}"]`)?.textContent).not.toContain("nodeKinds:task");
    expect(document.querySelector('[data-step-card="flow_task-2"]')?.textContent).toContain("nodeKinds:flow_task");
  });
});

describe("a card's Private badge", () => {
  it("badges a card marked Private itself, and not an unmarked one beside it", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { status: "active", isPrivate: true }), n(`goal-${storedRowId(3)}`, "goal", { status: "active" })]);
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
    render(<StepsView />);

    expect(document.querySelector(`[data-step-card="goal-${storedRowId(1)}"] [title="private"]`)).not.toBeNull();
    expect(document.querySelector(`[data-step-card="goal-${storedRowId(3)}"] [title="private"]`)).toBeNull();
  });
});

describe("the Info notes on a card", () => {
  it("draws the first ones as bullets", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", {
      children: [n(`info-${storedRowId(1)}`, "info", { title: "watch the migration" })],
    })]);
    render(<StepsView />);

    expect(screen.getByText("watch the migration")).toBeTruthy();
  });

  it("says what it had no room for rather than dropping it in silence", () => {
    // The smallest card, with more notes than any card could hold.
    useViewStore.setState({ stepsZoom: 1 });
    const notes = Array.from({ length: 12 }, (_, i) => n(`info-${i}`, "info", { title: `note ${i}` }));
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: notes })]);
    render(<StepsView />);

    expect(screen.getByText("stepsView:moreNotes")).toBeTruthy();
  });
});

describe("acting on the selected card", () => {
  it("cycles a Task's status on Space", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("Space");

    expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(1), "advance");
  });

  it("steps a Task's status when its glyph is tapped, selects the card, and does not open it", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    const glyph = screen.getByRole("button", { name: "listView:cycleStatus" });
    fireEvent.click(glyph);
    fireEvent.doubleClick(glyph);

    expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(1), "advance");
    expect(selectedCardId()).toBe(`task-${storedRowId(1)}`);
    expect(setEditorModal).not.toHaveBeenCalled();
  });

  it("refuses Space on a blocked Task out loud, and writes nothing", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo", virtualBlockers: ["Blocked by Spec"] })]);
    render(<StepsView />);

    press("ArrowDown");
    press("Space");

    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBlocked");
  });

  it("refuses Space on a Task with a block reason of its own", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "in_progress", blockReasons: ["waiting on legal"] })]);
    render(<StepsView />);

    press("ArrowDown");
    press("Space");

    expect(stepTaskStatus).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBlocked");
  });

  it("sends Alt+Enter on a Task, Started or not", async () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "in_progress" }), n(`task-${storedRowId(2)}`, "task", { status: "started" })]);
    render(<StepsView />);

    press("ArrowDown");
    act(() => { fireEvent.keyDown(window, { code: "Enter", altKey: true }); });
    expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(1), "alt");

    press("ArrowRight");
    act(() => { fireEvent.keyDown(window, { code: "Enter", altKey: true }); });
    // The second press goes out once the first is answered: the lane sends in order.
    await waitFor(() => expect(stepTaskStatus).toHaveBeenCalledWith(storedRowId(2), "alt"));
  });

  it("refuses Alt+Enter on a blocked Task", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo", blockReasons: ["waiting"] })]);
    render(<StepsView />);

    press("ArrowDown");
    act(() => { fireEvent.keyDown(window, { code: "Enter", altKey: true }); });
    expect(stepTaskStatus).not.toHaveBeenCalled();
  });

  it("opens the editor on E", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyE");

    expect(setEditorModal).toHaveBeenCalledWith(expect.objectContaining({ nodeId: `task-${storedRowId(1)}` }));
  });
});

describe("an empty Step", () => {
  it("offers to create the first child, and opens its editor to be named", async () => {
    mockTree([n(`task-${storedRowId(1)}`, "task")]);
    useMindmapStore.setState({ subtreeRootId: `task-${storedRowId(1)}` });
    render(<StepsView />);

    expect(screen.getByText("stepsView:emptyStep")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("stepsView:createFirstChild"));
    });

    expect(createChild).toHaveBeenCalledWith(`task-${storedRowId(1)}`, "task", "");
    expect(setEditorModal).toHaveBeenCalledWith(expect.objectContaining({ nodeId: `task-${storedRowId(99)}` }));
  });

  it("says the filter emptied it, rather than offering a child it already has", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { status: "active", children: [n(`task-${storedRowId(1)}`, "task", { status: "done" })] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
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
    const goal = n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task"), n(`task-${storedRowId(2)}`, "task")] });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    const { rerender } = render(<StepsView />);

    selectFirstCard();
    pressWith("Enter", { shift: true });
    await settle();

    // The Mindmap's own sibling action: a node of the same kind, under the Step, carrying the
    // source's own Agentic answer ("inherit" when it gave none).
    expect(createNode).toHaveBeenCalledWith(`goal-${storedRowId(1)}`, "goal", "task", "", "inherit");
    // The reload is simulated by the tree now holding the new card.
    mockTree([{ ...goal, children: [...goal.children, n(`task-${storedRowId(98)}`, "task")] }]);
    rerender(<StepsView />);
    expect(selectedCardId()).toBe(`task-${storedRowId(98)}`);
    expect(screen.getByLabelText("stepsView:titleLabel")).toBeTruthy();
  });

  it("makes a child of the header card a card on this Step, without moving", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    press("ArrowUp"); // onto the header
    press("ArrowDown");
    press("ArrowUp");
    press("Tab");
    await settle();

    expect(createNode).toHaveBeenCalledWith(`goal-${storedRowId(1)}`, "goal", "task", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe(`goal-${storedRowId(1)}`);
  });

  it("steps into a card when the new node is its child, as the Mindmap puts it under that card", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("Tab");
    await settle();

    expect(createNode).toHaveBeenCalledWith(`task-${storedRowId(1)}`, "task", "task", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe(`task-${storedRowId(1)}`);
  });

  it("does not step in when the create is refused, and says why", async () => {
    // A Tag holds notes and nothing else, so Tab (which creates a Task) is refused.
    mockTree([n(`domain-${storedRowId(1)}`, "domain", { children: [n(`domain-${storedRowId(2)}`, "tag")] })]);
    useMindmapStore.setState({ subtreeRootId: `domain-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("Tab");
    await settle();

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().subtreeRootId).toBe(`domain-${storedRowId(1)}`);
    expect(useMindmapStore.getState().pendingToast?.message).toContain("typedChildRefused");
  });

  it("opens the new-Habit editor on Shift+H, with repeating already on", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    pressWith("KeyH", { shift: true }); // nothing selected: onto the Step's own Goal
    expect(screen.getByText("editor:newHabitTitle")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "makeHabit" })).toBeChecked();
  });

  it("refuses a sibling of the Step itself, which would land outside it", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowUp");
    pressWith("Enter", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedSiblingOfStep");
  });

  it("refuses every create on the board's own card, out loud", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect")]);
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
    const goal = n(`goal-${storedRowId(1)}`, "goal", {
      children: [n(`task-${storedRowId(1)}`, "task", { children: [n(`task-${storedRowId(3)}`, "task")] }), n(`task-${storedRowId(2)}`, "task")],
    });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("Delete");
    expect(removeNode).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByText("warnings:deleteConfirm")); });

    expect(removeNode).toHaveBeenCalledWith([
      { id: `task-${storedRowId(3)}`, kind: "task" }, { id: `task-${storedRowId(1)}`, kind: "task" },
    ]);
    expect(selectedCardId()).toBe(`task-${storedRowId(2)}`);
  });

  it("lands on the card before when the last one goes", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task"), n(`task-${storedRowId(2)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowRight");
    press("Delete");
    await act(async () => { fireEvent.click(screen.getByText("warnings:deleteConfirm")); });

    expect(selectedCardId()).toBe(`task-${storedRowId(1)}`);
  });

  it("refuses the Step you are standing on", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    selectFirstCard();
    press("ArrowUp");
    press("Delete");

    expect(screen.queryByText("warnings:deleteConfirm")).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedDeleteStep");
  });

  it("refuses an Aspect, as the Mindmap does", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect")]);
    render(<StepsView />);
    selectFirstCard();
    press("Delete");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:deleteAspectRefused");
  });

  it("refuses a Habit repetition, which is drawn rather than stored, as the Mindmap does", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(5)}`, "task", { virtual: true })] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);
    selectFirstCard();
    press("Delete");
    expect(screen.queryByText("warnings:deleteConfirm")).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:deleteRepetitionRefused");
  });

  it("refuses the board's own card", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect")]);
    render(<StepsView />);
    selectFirstCard();
    press("ArrowUp");
    press("Delete");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });
});

describe("undoing from a Step", () => {
  it("takes a create back with one Ctrl+Z", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] })]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    const { rerender } = render(<StepsView />);

    selectFirstCard();
    pressWith("Enter", { shift: true });
    await settle();
    mockTree([n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task"), n(`task-${storedRowId(98)}`, "task")] })]);
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
    const goal = n(`goal-${storedRowId(1)}`, "goal", { children: [n(`task-${storedRowId(1)}`, "task")] });
    mockTree([goal]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    const { rerender } = render(<StepsView />);

    expect(selectedCardId()).toBeNull();
    pressWith("KeyT", { shift: true });
    await settle();

    expect(createNode).toHaveBeenCalledWith(`goal-${storedRowId(1)}`, "goal", "task", "");
    expect(useMindmapStore.getState().subtreeRootId).toBe(`goal-${storedRowId(1)}`);
    mockTree([{ ...goal, children: [...goal.children, n(`task-${storedRowId(98)}`, "task")] }]);
    rerender(<StepsView />);
    expect(selectedCardId()).toBe(`task-${storedRowId(98)}`);
    expect(screen.getByLabelText("stepsView:titleLabel")).toBeTruthy();
  });

  it("refuses out loud at the board, where nothing can be created", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect")]);
    render(<StepsView />);

    pressWith("KeyD", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });

  it("refuses a kind the Step cannot hold, in the Mindmap's words", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    pressWith("KeyP", { shift: true });

    expect(createNode).not.toHaveBeenCalled();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:typedChildRefused");
  });

  it("does nothing while a text field has focus — the letter is typed, not a command", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<><StepsView /><input aria-label="elsewhere" /></>);

    const field = screen.getByLabelText("elsewhere");
    field.focus();
    act(() => { fireEvent.keyDown(field, { code: "KeyT", shiftKey: true }); });

    expect(createNode).not.toHaveBeenCalled();
  });
});

describe("the Step's +", () => {
  it("is not offered on the board, where nothing can be created", () => {
    mockTree([n(`domain-${storedRowId(1)}`, "aspect")]);
    render(<StepsView />);
    expect(screen.queryByLabelText("stepsView:addToStep")).toBeNull();
  });

  it("offers only the kinds the Step can hold, each with its chord", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    fireEvent.click(screen.getByRole("button", { name: "stepsView:addToStep" }));

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toContain("nodeKinds:taskShift+T");
    expect(items.some((item) => item?.startsWith("nodeKinds:project") === true)).toBe(false);
  });

  it("creates the chosen kind on the Step, as its chord would", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
    render(<StepsView />);

    fireEvent.click(screen.getByRole("button", { name: "stepsView:addToStep" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /nodeKinds:task/ }));
    await settle();

    expect(createNode).toHaveBeenCalledWith(`goal-${storedRowId(1)}`, "goal", "task", "");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is driven from the keyboard: arrows move, Enter picks, Escape closes", async () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    useMindmapStore.setState({ subtreeRootId: `goal-${storedRowId(1)}` });
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
    expect(createNode.mock.calls[0]?.[0]).toBe(`goal-${storedRowId(1)}`);
    expect(`nodeKinds:${createNode.mock.calls[0]?.[2] ?? ""}`).toBe(second.replace(/Shift\+.$/, ""));
  });
});

describe("P, the quick Plan picker", () => {
  it("opens the Plan picker at the selected Task card, writes the pick, and one Ctrl+Z takes it back", async () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyP");
    const dialog = screen.getByRole("dialog", { name: "quickPlanPicker" });
    const day = [...dialog.querySelectorAll("button")].find((b) => /^\d+$/.test(b.textContent ?? ""));
    if (day === undefined) throw new Error("the picker drew no Day cells");
    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(storedRowId(1), {
      plan: expect.objectContaining({ start_id: expect.objectContaining({ kind: "day" }) }),
    }));
    expect(screen.queryByRole("dialog", { name: "quickPlanPicker" })).toBeNull();
    // The write has landed once the board reloads; only then is there a step to take back.
    await waitFor(() => expect(settleBoard).toHaveBeenCalled());

    pressWith("KeyZ", { ctrl: true });
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("holds the view's own keys while it is open, and Escape closes it writing nothing", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyP");
    press("Space");
    expect(updateTask).not.toHaveBeenCalled();
    expect(stepTaskStatus).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByRole("dialog", { name: "quickPlanPicker" })).toBeNull();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses a card that holds no Plan, by name", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyP");
    expect(screen.queryByRole("dialog", { name: "quickPlanPicker" })).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:quickPlanNotTask");
  });

  it("refuses the board's own card", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    render(<StepsView />);

    press("ArrowUp");
    press("KeyP");
    expect(useMindmapStore.getState().pendingToast?.message).toBe("stepsView:refusedBoardRoot");
  });
});

describe("D, the quick dependency picker", () => {
  it("opens a search at the selected Task card, adds the pick, and one Ctrl+Z takes it back", async () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" }), n("expectation-7", "expectation", { title: "Parts arrive" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyD");
    const dialog = screen.getByRole("dialog", { name: "editor:quickDependencyPicker" });
    const search = screen.getByRole("combobox");
    await waitFor(() => expect(fetchDependencyCandidates).toHaveBeenCalledWith(storedRowId(1)));
    fireEvent.change(search, { target: { value: "parts" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(addTaskDependency).toHaveBeenCalledWith(storedRowId(1), { type: "expectation", id: storedRowId(7) }));
    expect(dialog.isConnected).toBe(false);
    await waitFor(() => expect(settleBoard).toHaveBeenCalled());

    pressWith("KeyZ", { ctrl: true });
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("holds the view's own keys while it is open, and Escape closes it writing nothing", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo" })]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyD");
    press("Space");
    expect(updateTask).not.toHaveBeenCalled();
    expect(stepTaskStatus).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByRole("dialog", { name: "editor:quickDependencyPicker" })).toBeNull();
    expect(addTaskDependency).not.toHaveBeenCalled();
  });

  it("refuses a card that holds no dependencies, by name", () => {
    mockTree([n(`goal-${storedRowId(1)}`, "goal")]);
    render(<StepsView />);

    press("ArrowDown");
    press("KeyD");
    expect(screen.queryByRole("dialog", { name: "editor:quickDependencyPicker" })).toBeNull();
    expect(useMindmapStore.getState().pendingToast?.message).toBe("warnings:quickDependencyNotTask");
  });
});

describe("an Overdue card", () => {
  function stepCard(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-step-card="${id}"]`);
    if (element === null) throw new Error(`no card for ${id}`);
    return element;
  }

  it("draws the amber border and says Overdue in its description", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo", overdue: true }), n(`task-${storedRowId(2)}`, "task", { status: "todo" })]);
    render(<StepsView />);
    expect(stepCard(`task-${storedRowId(1)}`).className).toMatch(/overdue/);
    expect(stepCard(`task-${storedRowId(1)}`)).toHaveAccessibleDescription("overdue");
    expect(stepCard(`task-${storedRowId(2)}`).className).not.toMatch(/overdue/);
    expect(stepCard(`task-${storedRowId(2)}`)).not.toHaveAttribute("aria-describedby");
  });

  it("carries both the Overdue and the selected class when selected, so its ring takes the selected-and-Overdue colour", () => {
    mockTree([n(`task-${storedRowId(1)}`, "task", { status: "todo", overdue: true })]);
    render(<StepsView />);
    press("ArrowDown");
    expect(selectedCardId()).toBe(`task-${storedRowId(1)}`);
    expect(stepCard(`task-${storedRowId(1)}`).className).toMatch(/overdue/);
    expect(stepCard(`task-${storedRowId(1)}`).className).toMatch(/selected/);
  });
});
