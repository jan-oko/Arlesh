import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import MindmapView from "./MindmapView";
import { useMindmapData } from "./use-mindmap-data";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_HABIT_COLLAPSE_THRESHOLD, habitRunId } from "@/utils/habit-collapse";
import type { HabitIterationMeta, MindmapNode } from "@/utils/tree-layout";
import { mockGestureProtocol } from "@/test/command-mock";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./use-mindmap-data");
// The editor's own loads are beside the point here, and unstubbed they leave the view chasing
// domains and tags it never shows.
vi.mock("./use-node-editor", () => ({
  useNodeEditor: () => ({
    editorModal: null,
    setEditorModal: vi.fn(),
    allTags: [],
    domainNames: new Map(),
    availableForDep: [],
    onDoubleClick: vi.fn(),
    onTaskSave: vi.fn(),
    onGoalSave: vi.fn(),
    onCommitmentSave: vi.fn(),
    onSimpleSave: vi.fn(),
    onProjectSave: vi.fn(),
    onInfoSave: vi.fn(),
    onFlowSave: vi.fn(),
    onFlowItemSave: vi.fn(),
    checkScopeClamp: vi.fn(),
    confirmScopeClamp: vi.fn(),
    scopeClampRequest: null,
    resolveScopeClamp: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const FLOW = 7;

/** One passed, day-long iteration of Habit 7, anchored on `date`. */
function iteration(date: string, index: number): MindmapNode {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const habitIteration: HabitIterationMeta = {
    flowId: FLOW,
    flowTitle: "Journal",
    index,
    scopeKind: "day",
    anchorDate: date,
    windowEnd: `${next.toISOString().slice(0, 10)}T00:00:00`,
    passed: true,
    done: false,
  };
  return {
    id: `habit-${FLOW}-${index}-virtual`,
    kind: "task",
    title: date,
    status: "todo",
    virtual: true,
    habitIteration,
    position: index,
    tagIds: [],
    children: [],
  };
}

// Two days in the week of the 6th and two in the week of the 13th, so the run expands into two
// week levels. `task-9` is an ordinary node beside the fold — what arrowing on and off it reaches.
//
//   root ── goal-5 ─┬─ habitrun-7-virtual ─┬─ week of 2026-09-06 ── two iterations
//                   │                      └─ week of 2026-09-13 ── two iterations
//                   └─ task-9
const TREE: MindmapNode = {
  id: "root", kind: "domain", title: "Root", position: 0, tagIds: [],
  children: [{
    id: "goal-5", kind: "goal", title: "Fitness", status: "active", position: 0, tagIds: [],
    children: [
      ...["2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16"].map(iteration),
      { id: "task-9", kind: "task", title: "Live task", status: "todo", position: 4, tagIds: [], children: [] },
    ],
  }],
};

const RUN = habitRunId(FLOW);

function mindmapStore() {
  const store = useTabsStore.getState().tabs[0]?.stores.mindmap;
  if (store === undefined) throw new Error("no active tab");
  return store;
}

function selected(): string | null {
  return mindmapStore().getState().selectedNodeId;
}

function select(id: string): void {
  act(() => { mindmapStore().getState().selectNode(id); });
}

function press(key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}): void {
  act(() => {
    fireEvent.keyDown(window, { key, code: key === "/" ? "Slash" : key, ...modifiers });
  });
}

beforeEach(() => {
  mockGestureProtocol();
  vi.mocked(useMindmapData).mockReturnValue({
    tree: TREE,
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    createNode: vi.fn(),
    createChild: vi.fn(),
    renameNode: vi.fn(),
    retypeNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    removeNode: vi.fn(),
    createCommitment: vi.fn(),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
    reload: vi.fn(),
  } as unknown as ReturnType<typeof useMindmapData>);
  useFilterStore.setState({ filter: DEFAULT_FILTER });
  useDisplayStore.setState({ habitCollapseThreshold: DEFAULT_HABIT_COLLAPSE_THRESHOLD });
  // Horizontal, so parent↔child runs left/right and siblings up/down — which is what the arrow
  // expectations below are written in.
  useViewStore.setState({ mindmapOrientation: "horizontal" });
  mindmapStore().setState({
    selectedNodeId: null,
    selectedNodeIds: new Set(),
    collapsedNodeIds: new Set(),
    expandedHabitGroupIds: new Set(),
    subtreeRootId: null,
  });
});

/**
 * The folded run exists only in the tree the canvas draws — it has no counterpart in the loaded
 * one — so navigation that reads its candidates from the loaded tree can neither reach it nor
 * leave it. These are the arrows that shipped broken.
 */
describe("arrow navigation over a folded Habit run", () => {
  it("arrows onto the folded run from the sibling below it", () => {
    render(<MindmapView />);
    select("task-9");

    press("ArrowUp");

    expect(selected()).toBe(RUN);
  });

  it("arrows off the folded run to that sibling again", () => {
    render(<MindmapView />);
    select(RUN);

    press("ArrowDown");

    expect(selected()).toBe("task-9");
  });

  it("arrows off the folded run to its parent", () => {
    render(<MindmapView />);
    select(RUN);

    press("ArrowLeft");

    expect(selected()).toBe("goal-5");
  });

  it("arrows from the parent down into the folded run", () => {
    render(<MindmapView />);
    select("goal-5");

    press("ArrowRight");

    expect(selected()).toBe(RUN);
  });

  it("stays put arrowing into a run that is still folded", () => {
    render(<MindmapView />);
    select(RUN);

    press("ArrowRight");

    expect(selected()).toBe(RUN);
  });
});

describe("arrow navigation inside an opened run", () => {
  /** Opens the run with Ctrl+/ and answers with the first scope level inside it. */
  function openRun(container: HTMLElement): string {
    select(RUN);
    press("/", { ctrlKey: true });
    const level = container.querySelector("[data-node-id^='habitrun-7-week-']");
    const id = level?.getAttribute("data-node-id");
    if (id === null || id === undefined) throw new Error("the opened run drew no scope level");
    return id;
  }

  it("arrows from the run into its scope levels, and back out of them", () => {
    const { container } = render(<MindmapView />);
    const week = openRun(container);

    press("ArrowRight");
    expect(selected()).toBe(week);

    press("ArrowLeft");
    expect(selected()).toBe(RUN);
  });

  it("arrows all the way back out to the rest of the tree", () => {
    const { container } = render(<MindmapView />);
    openRun(container);

    press("ArrowRight");
    press("ArrowLeft");
    press("ArrowDown");

    expect(selected()).toBe("task-9");
  });

  it("opens a scope level onto its iterations, which arrow back to it", () => {
    const { container } = render(<MindmapView />);
    const week = openRun(container);
    select(week);
    press("/", { ctrlKey: true });

    select("habit-7-0-virtual");
    press("ArrowLeft");

    expect(selected()).toBe(week);
  });
});

/**
 * Opening a run is a request to see the shape of the history, not every day of it. The levels come
 * up shut, so a year of a kept daily Habit opens as four seasons rather than 365 nodes.
 */
describe("opening a folded run", () => {
  it("draws the scope levels and nothing beneath them", () => {
    const { container } = render(<MindmapView />);
    openWithCtrlSlash();

    expect(container.querySelectorAll("[data-node-id^='habitrun-7-week-']")).toHaveLength(2);
    expect(container.querySelector("[data-node-id='habit-7-0-virtual']")).toBeNull();
  });

  it("opens one level onto its own iterations, leaving its neighbour shut", () => {
    const { container } = render(<MindmapView />);
    openWithCtrlSlash();
    const levels = [...container.querySelectorAll("[data-node-id^='habitrun-7-week-']")];
    const first = levels[0]?.getAttribute("data-node-id") ?? "";

    select(first);
    press("/", { ctrlKey: true });

    expect(container.querySelector("[data-node-id='habit-7-0-virtual']")).not.toBeNull();
    expect(container.querySelector("[data-node-id='habit-7-2-virtual']")).toBeNull();
  });

  function openWithCtrlSlash(): void {
    select(RUN);
    press("/", { ctrlKey: true });
  }
});

/**
 * Ctrl+Alt+/ opens a whole subtree at once. Over the fold that means every scope level *and*
 * every iteration behind them, which is the case Ctrl+/ deliberately will not do: opening a run one
 * level at a time is right when you are looking for the shape of the history, and wrong when you
 * want the days themselves and would otherwise open four seasons, twelve months and fifty-two
 * weeks by hand.
 */
describe("expanding a folded Habit run and everything under it", () => {
  it("opens every scope level and every iteration in one press", () => {
    const { container } = render(<MindmapView />);
    select(RUN);

    press("/", { ctrlKey: true, altKey: true });

    expect(container.querySelectorAll("[data-node-id^='habitrun-7-week-']")).toHaveLength(2);
    for (const index of [0, 1, 2, 3]) {
      expect(container.querySelector(`[data-node-id='habit-7-${index}-virtual']`)).not.toBeNull();
    }
  });

  it("clears an ordinary collapse and opens the fold beneath it in the same press", () => {
    const { container } = render(<MindmapView />);
    act(() => { mindmapStore().setState({ collapsedNodeIds: new Set(["goal-5"]) }); });
    select("goal-5");

    press("/", { ctrlKey: true, altKey: true });

    expect(container.querySelector("[data-node-id='task-9']")).not.toBeNull();
    expect(container.querySelector("[data-node-id='habit-7-3-virtual']")).not.toBeNull();
  });

  it("leaves a run outside the pressed subtree folded", () => {
    const { container } = render(<MindmapView />);
    act(() => { mindmapStore().setState({ collapsedNodeIds: new Set(["task-9"]) }); });
    select("task-9");

    press("/", { ctrlKey: true, altKey: true });

    expect(container.querySelector("[data-node-id^='habitrun-7-week-']")).toBeNull();
  });
});

/**
 * The same chord shuts what it opened. Which way a press goes is read off the cell it was pressed
 * on — drawn shut means open it, drawn open means shut it — so the second press is always the
 * other direction, and the board comes back to where it started.
 *
 * The collapse descends past that cell rather than merely shutting it, because the two sets are
 * also what the single-cell `Ctrl+/` reads: leaving the inside of a run open would make the next
 * `Ctrl+/` on it reveal every iteration at once instead of the levels.
 */
describe("collapsing a subtree with the same chord", () => {
  /** Every cell the canvas is drawing, in id order — the board as the user sees it. */
  function drawnIds(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-node-id]")]
      .map((element) => element.getAttribute("data-node-id") ?? "")
      .sort();
  }

  function pressChord(): void {
    press("/", { ctrlKey: true, altKey: true });
  }

  it("puts the board back exactly as it was, over both mechanisms at once", () => {
    // `goal-5` is collapsed and the fold sits underneath it: one press has to clear the ordinary
    // collapse *and* open the run, and the second has to undo both.
    const { container } = render(<MindmapView />);
    act(() => { mindmapStore().setState({ collapsedNodeIds: new Set(["goal-5"]) }); });
    select("goal-5");
    const before = drawnIds(container);

    pressChord();
    const opened = drawnIds(container);
    pressChord();

    expect(opened).not.toEqual(before);
    expect(opened).toContain("habit-7-3-virtual");
    expect(drawnIds(container)).toEqual(before);
  });

  it("re-folds a run it opened, levels and all", () => {
    const { container } = render(<MindmapView />);
    select(RUN);
    const before = drawnIds(container);

    pressChord();
    pressChord();

    expect(drawnIds(container)).toEqual(before);
  });

  it("leaves the levels inside a re-folded run shut, so Ctrl+/ opens it one level again", () => {
    const { container } = render(<MindmapView />);
    select(RUN);

    pressChord();
    pressChord();
    press("/", { ctrlKey: true });

    expect(container.querySelectorAll("[data-node-id^='habitrun-7-week-']")).toHaveLength(2);
    expect(container.querySelector("[data-node-id='habit-7-0-virtual']")).toBeNull();
  });

  it("shuts a cell that was already open, rather than opening it again", () => {
    const { container } = render(<MindmapView />);
    select("goal-5");

    pressChord();

    expect(container.querySelector("[data-node-id='goal-5']")).not.toBeNull();
    expect(container.querySelector("[data-node-id='task-9']")).toBeNull();
    expect(container.querySelector(`[data-node-id='${RUN}']`)).toBeNull();
  });
});
