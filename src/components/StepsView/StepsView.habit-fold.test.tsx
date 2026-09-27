import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StepsView from "./StepsView";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useDisplayStore } from "@/stores/use-display-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { occurrenceRow } from "@/test/occurrence";
import { habitRunId } from "@/utils/habit-collapse";
import type { HabitIterationMeta, MindmapNode, NodeKind } from "@/utils/tree-layout";

// The options go into the text, so a card's title shows the tally the fold labelled it with.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined
        ? key
        : `${key}(${Object.entries(options).map(([name, value]) => `${name}=${String(value)}`).join(",")})`,
  }),
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

const FLOW = 7;
const RUN = habitRunId(FLOW);
// The two week levels the run below expands into, keyed by the first day under each.
const WEEK_ONE = `habitrun-${FLOW}-week-2026-09-08-virtual`;
const WEEK_TWO = `habitrun-${FLOW}-week-2026-09-15-virtual`;

/** One passed, day-long iteration of Habit 7, anchored on `date`. */
function iteration(date: string, index: number, status = "todo"): MindmapNode {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const habitIteration: HabitIterationMeta = {
    flowId: FLOW,
    flowTitle: "Journal",
    index,
    scopeKind: "day",
    anchorDate: date,
    windowEnd: `${next.toISOString().slice(0, 10)}T02:00:00`,
    passed: true,
    done: status === "done",
  };
  // A Habit occurrence, as the board loads one: a derived row, which can be stepped into.
  return {
    id: `habit-${FLOW}-${index}-virtual`, kind: "task", title: date, status, virtual: true,
    ...occurrenceRow({ habitId: FLOW, itemType: "flow_root", index, startDate: date }),
    habitIteration, position: index, tagIds: [], children: [],
  };
}

const DATES = ["2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16"];

// Two days in the week of the 6th and two in the week of the 13th, so the run expands into two
// week levels. `task-9` is an ordinary node beside the fold.
//
//   root ── goal-5 ─┬─ four passed iterations of Journal
//                   └─ task-9
function hostWith(iterations: MindmapNode[]): MindmapNode {
  return {
    id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [],
    children: [{
      id: "goal-5", rowId: 5, kind: "goal", title: "Fitness", status: "active", position: 0, tagIds: [],
      children: [
        ...iterations,
        { id: "task-9", rowId: 9, kind: "task", title: "Live task", status: "todo", position: 9, tagIds: [], children: [] },
      ],
    }],
  };
}

const createChild = vi.fn((_parentId: string, _parentKind: NodeKind, _title: string) => Promise.reject(new Error("no")));
const createNode = vi.fn(() => Promise.reject(new Error("no")));

function mockTree(tree: MindmapNode): void {
  vi.mocked(useMindmapData).mockReturnValue({
    tree,
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    reload: vi.fn(() => Promise.resolve()),
    createNode,
    createChild,
    renameNode: vi.fn(),
    retypeNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    removeNode: vi.fn(),
    createCommitment: vi.fn(),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
  });
}

function cardIds(): string[] {
  return [...document.querySelectorAll("[data-step-card]")].map((el) => el.getAttribute("data-step-card") ?? "");
}

function card(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-step-card="${id}"]`);
  if (found === null) throw new Error(`no card ${id}`);
  return found;
}

function press(code: string, modifiers: { shiftKey?: boolean } = {}): void {
  act(() => { fireEvent.keyDown(window, { code, ...modifiers }); });
}

/** Selects the card `id` by clicking it, as the cursor would land on it. */
function select(id: string): void {
  act(() => { fireEvent.click(card(id)); });
}

function toast(): string | undefined {
  return useMindmapStore.getState().pendingToast?.message;
}

function crumbs(): Array<string | null> {
  return useMindmapStore.getState().subtreeNav?.ancestors.map((crumb) => crumb.id) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useDisplayStore.setState({ habitCollapseThreshold: 3 });
  useMindmapStore.setState({
    subtreeRootId: "goal-5", subtreeNav: null, pendingToast: null, searchOpen: false,
    selectedNodeId: null, selectedNodeIds: new Set(),
  });
  useViewStore.setState({ stepsZoom: 3 });
});

describe("a run of passed Habit iterations on a Step", () => {
  it("folds into one card once the run reaches the threshold", () => {
    mockTree(hostWith(DATES.slice(0, 3).map((date, index) => iteration(date, index))));
    render(<StepsView />);
    expect(cardIds()).toEqual(["goal-5", RUN, "task-9"]);
  });

  it("stays as separate cards below the threshold", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 4 });
    mockTree(hostWith(DATES.slice(0, 3).map((date, index) => iteration(date, index))));
    render(<StepsView />);
    expect(cardIds()).toEqual(["goal-5", "habit-7-0-virtual", "habit-7-1-virtual", "habit-7-2-virtual", "task-9"]);
  });

  it("is titled with its Habit and its tally, and names its day span in a tooltip", () => {
    mockTree(hostWith(DATES.map((date, index) => iteration(date, index, index === 0 ? "done" : "todo"))));
    render(<StepsView />);

    expect(card(RUN).textContent).toContain("collapse.run(habit=Journal,passed=4,done=1,missed=3)");
    expect(card(RUN).getAttribute("title")).toMatch(/^collapse\.span\(/);
    // Its title is the tally, so it carries no "n of m" count of its own.
    expect(card(RUN).textContent).not.toContain("stepsView:childCount");
  });

  it("folds after the filter, so it stands for only the iterations the filter kept", () => {
    const iterations = DATES.map((date, index) => iteration(date, index, index === 0 ? "in_progress" : "done"));
    mockTree(hostWith(iterations));
    const { unmount } = render(<StepsView />);
    expect(cardIds()).toContain(RUN);
    unmount();

    // Under Do only the one in progress survives: one iteration is not a run.
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    render(<StepsView />);
    expect(cardIds()).not.toContain(RUN);
    expect(cardIds()).toContain("habit-7-0-virtual");
  });
});

describe("descending into a folded run", () => {
  beforeEach(() => {
    mockTree(hostWith(DATES.map((date, index) => iteration(date, index))));
  });

  it("walks down through its scope levels to the iterations, one breadcrumb segment per level", () => {
    render(<StepsView />);

    select(RUN);
    press("Enter");
    expect(useMindmapStore.getState().subtreeRootId).toBe(RUN);
    expect(cardIds()).toEqual([RUN, WEEK_ONE, WEEK_TWO]);
    expect(crumbs()).toEqual([null, "goal-5"]);

    select(WEEK_TWO);
    press("Enter");
    expect(cardIds()).toEqual([WEEK_TWO, "habit-7-2-virtual", "habit-7-3-virtual"]);
    expect(crumbs()).toEqual([null, "goal-5", RUN]);

    // An iteration is a real Step, and climbing out of it lands on the level it was drawn in.
    select("habit-7-3-virtual");
    press("Enter");
    expect(useMindmapStore.getState().subtreeRootId).toBe("habit-7-3-virtual");
    expect(crumbs()).toEqual([null, "goal-5", RUN, WEEK_TWO]);
  });

  it("restores a run or a level saved as the tab's subtree root once the board has loaded", () => {
    useMindmapStore.setState({ subtreeRootId: WEEK_ONE });
    // What a reload looks like: an empty board first, then the loaded one.
    mockTree({ id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [], children: [] });
    const { rerender } = render(<StepsView />);
    mockTree(hostWith(DATES.map((date, index) => iteration(date, index))));
    rerender(<StepsView />);

    expect(useMindmapStore.getState().subtreeRootId).toBe(WEEK_ONE);
    expect(cardIds()).toEqual([WEEK_ONE, "habit-7-0-virtual", "habit-7-1-virtual"]);
    expect(crumbs()).toEqual([null, "goal-5", RUN]);
  });

  it("climbs to the run when a saved level is no longer drawn, rather than to the true root", () => {
    useMindmapStore.setState({ subtreeRootId: `habitrun-${FLOW}-week-2020-01-05-virtual` });
    render(<StepsView />);
    expect(useMindmapStore.getState().subtreeRootId).toBe(RUN);
  });

  it("climbs to the Habit's host when the run itself fell under the threshold", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 9 });
    useMindmapStore.setState({ subtreeRootId: RUN });
    render(<StepsView />);
    expect(useMindmapStore.getState().subtreeRootId).toBe("goal-5");
  });
});

describe("what a fold card refuses", () => {
  beforeEach(() => {
    mockTree(hostWith(DATES.map((date, index) => iteration(date, index))));
  });

  it("refuses E out loud — it is a drawing, with no editor behind it", () => {
    render(<StepsView />);
    select(RUN);
    press("KeyE");
    expect(setEditorModal).not.toHaveBeenCalled();
    expect(toast()).toMatch(/^stepsView:refusedNoEditor/);
  });

  it("refuses to create a child in it, out loud", () => {
    render(<StepsView />);
    select(RUN);
    press("Tab");
    expect(createChild).not.toHaveBeenCalled();
    expect(toast()).toMatch(/^stepsView:refusedCreateInDrawing/);

    press("KeyT", { shiftKey: true });
    expect(createNode).not.toHaveBeenCalled();
    expect(toast()).toMatch(/^stepsView:refusedCreateInDrawing/);
  });

  it("offers no + on a Step that is a fold, and refuses a typed chord onto it", () => {
    useMindmapStore.setState({ subtreeRootId: RUN });
    render(<StepsView />);
    expect(screen.queryByLabelText("stepsView:addToStep")).toBeNull();

    press("KeyT", { shiftKey: true });
    expect(createNode).not.toHaveBeenCalled();
    expect(toast()).toMatch(/^stepsView:refusedCreateInDrawing/);
  });

  it("refuses to be deleted or marked, out loud", () => {
    render(<StepsView />);
    select(RUN);
    press("Delete");
    expect(toast()).toMatch(/^stepsView:refusedActOnDrawing/);
    act(() => { useMindmapStore.setState({ pendingToast: null }); });
    press("Space");
    expect(toast()).toMatch(/^stepsView:refusedActOnDrawing/);
  });
});
