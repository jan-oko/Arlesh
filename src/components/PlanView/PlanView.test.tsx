import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PlanView from "./PlanView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { useListData } from "@/hooks/use-list-data";
import { clearScopeWindowCache } from "@/hooks/use-scope-windows";
import { clearScopeRowCache } from "@/hooks/use-scope-rows";
import { useDisplayStore } from "@/stores/use-display-store";

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
    onClearBeadsId: vi.fn(),
    checkScopeClamp: vi.fn(),
  }),
}));
vi.mock("@/components/TaskEditorModal/TaskEditorModal", () => ({ default: () => <div data-testid="editor-modal" /> }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

// The scope catalogue the backend stands in for: the week being filled, the week after it, a day
// inside the first, and the week's resolved window.
const WEEK_ID = 10;
const NEXT_WEEK_ID = 11;
const DAY_ID = 20;
// A second day inside the same week, later than DAY_ID: the two together are what tell section
// order apart from triage order.
const LATER_DAY_ID = 21;
const WINDOWS: Record<number, { start: string; end: string }> = {
  [WEEK_ID]: { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" },
  [NEXT_WEEK_ID]: { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" },
  [DAY_ID]: { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" },
  [LATER_DAY_ID]: { start: "2026-09-24T00:00:00", end: "2026-09-25T00:00:00" },
};

/** The scope **rows** the sectioning reads — dates, never the datetimes, which stay null. */
const SCOPE_ROWS: Record<number, unknown> = {
  [WEEK_ID]: { id: WEEK_ID, kind: "week", label: "W39", start_date: "2026-09-20", end_date: "2026-09-26" },
  [DAY_ID]: { id: DAY_ID, kind: "day", label: "D", start_date: "2026-09-22", end_date: "2026-09-22" },
  [LATER_DAY_ID]: { id: LATER_DAY_ID, kind: "day", label: "D", start_date: "2026-09-24", end_date: "2026-09-24" },
};
const getScope = vi.fn((id: number) => {
  const base = SCOPE_ROWS[id];
  if (base === undefined) return Promise.reject(new Error(`no scope ${String(id)}`));
  return Promise.resolve({
    week_id: null, month_id: null, season_id: null, day_id: null, part: null,
    start_datetime: null, end_datetime: null, ...base,
  });
});

const getOrCreateScope = vi.fn((_kind: string, date: string) =>
  Promise.resolve({
    id: date === "2026-09-27" ? NEXT_WEEK_ID : WEEK_ID,
    kind: "week",
    label: "W39",
    start_date: date === "2026-09-27" ? "2026-09-27" : "2026-09-20",
    end_date: date === "2026-09-27" ? "2026-10-03" : "2026-09-26",
    week_id: null, month_id: null, season_id: null, day_id: null, part: null,
    start_datetime: null, end_datetime: null,
  }),
);
const resolveScope = vi.fn((id: number) =>
  Promise.resolve({ ...(WINDOWS[id] ?? { start: "", end: "" }), active: false }),
);
vi.mock("@/api/scopes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/scopes")>()),
  getOrCreateScope: (kind: string, date: string) => getOrCreateScope(kind, date),
  getOrCreatePartScope: (date: string, part: string) => getOrCreateScope(part, date),
  resolveScope: (id: number) => resolveScope(id),
  getScope: (id: number) => getScope(id),
}));

const updateTask = vi.fn((_id: number, _request: unknown) => Promise.resolve());
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: number, request: unknown) => updateTask(id, request),
}));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(node: MindmapNode, ancestors: MindmapNode[] = []): TaskListRow {
  return {
    node,
    ancestors,
    goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, isAgentic: false, isAsynchronous: false,
    hasBlockedAncestor: false, hasPrivateAncestor: false, scopeTokens: [],
  };
}

const reload = vi.fn(() => Promise.resolve());

function mockRows(rows: TaskListRow[]): void {
  vi.mocked(useListData).mockReturnValue({
    tree: { ...n("root", "domain"), children: rows.map((r) => r.node) },
    rows,
    commitmentRows: [],
    allTasksAndGoals: [],
    isLoading: false,
    error: null,
    reload,
    onCycleStatus: vi.fn(),
    // The Plan View never cycles a status and never triages a virtual occurrence, so the
    // occurrence-completion prompt cannot be raised from it; it is stubbed only to satisfy the
    // shape `useListData` returns.
    occurrencePrompt: null,
    confirmOccurrence: vi.fn(),
    cancelOccurrence: vi.fn(),
    renameNode: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    removeNode: vi.fn(),
  });
}

/** Lets the promise chain behind a write — open the Gesture, write, reload — settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await act(async () => { await Promise.resolve(); });
}

/** Renders and lets the scope materialize and resolve before anything is asserted. */
async function renderPlanView(): Promise<void> {
  render(<PlanView />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** The cards in one pane, in the order they are drawn. */
function cardsIn(pane: "candidates" | "planned"): string[] {
  const section = document.querySelector(`[data-plan-pane="${pane}"]`);
  if (section === null) throw new Error(`no ${pane} pane on screen`);
  return [...section.querySelectorAll("[data-plan-card-id]")].map((el) => el.getAttribute("data-plan-card-id") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  clearScopeWindowCache();
  clearScopeRowCache();
  // The kebab switches are set explicitly rather than left at their defaults: a pass opens on
  // *what still needs placing*, which is a different left-hand pane from the one most of these
  // tests are about. The ones that are about it set the switches back.
  useDisplayStore.setState({
    planCandidatesPathGrouping: false, planCandidatesParentOnly: false,
    planSubscopeSplit: false, planIncludePremorning: false,
  });
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useMindmapStore.setState({ subtreeRootId: null, pendingToast: null });
});

describe("the two panes", () => {
  it("offers the unplanned relevant task and shows the planned one as what the scope holds", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } })),
      row(n("task-3", "task", { timeScope: { start_id: NEXT_WEEK_ID, end_id: NEXT_WEEK_ID } })),
    ]);
    await renderPlanView();

    expect(cardsIn("candidates")).toEqual(["task-1"]);
    expect(cardsIn("planned")).toEqual(["task-2"]);
  });

  it("keeps backlogged work off the table until the switch says otherwise", async () => {
    mockRows([row(n("task-1", "task", { backlogged: true }))]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("showBacklogged"));
    });
    expect(cardsIn("candidates")).toEqual(["task-1"]);
  });
});

describe("moving a task across", () => {
  it("sets its Plan to the scope being filled", async () => {
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("planInto"));
    });
    expect(updateTask).toHaveBeenCalledWith(1, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
    expect(reload).toHaveBeenCalled();
  });

  it("clears the Plan on the way back", async () => {
    mockRows([row(n("task-2", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("unplan"));
    });
    expect(updateTask).toHaveBeenCalledWith(2, { plan: null });
  });

  it("refuses a move that escapes the task's own Time Scope, and says which bound stopped it", async () => {
    mockRows([row(n("task-1", "task", { timeScope: { start_id: DAY_ID, end_id: DAY_ID } }))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("planInto"));
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("refusedTimeScope")).toBeInTheDocument();
  });

  it("refuses a move that escapes the parent task's Plan", async () => {
    const parent = n("task-9", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } });
    mockRows([row(n("task-1", "task"), [parent])]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("planInto"));
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("refusedParentPlan")).toBeInTheDocument();
  });
});

describe("walking the scopes", () => {
  it("re-derives both panes against the next scope", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: NEXT_WEEK_ID, end_id: NEXT_WEEK_ID } })),
      row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } })),
    ]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual([]);
    expect(cardsIn("planned")).toEqual(["task-2"]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("nextScope"));
    });
    await act(async () => { await Promise.resolve(); });

    expect(getOrCreateScope).toHaveBeenCalledWith("week", "2026-09-27");
    expect(cardsIn("candidates")).toEqual(["task-1"]);
    expect(cardsIn("planned")).toEqual([]);
  });
});

describe("the keyboard", () => {
  it("plans the selected candidate with Enter, and advances to the next one", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      row(n("task-2", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
    ]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(window, { code: "Enter" });
    });

    expect(updateTask).toHaveBeenCalledWith(1, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
    const cards = document.querySelectorAll('[data-plan-pane="candidates"] [data-plan-card-id]');
    expect([...cards].some((card) => card.className.includes("cardSelected"))).toBe(true);
  });

  it("leaves the selection on a task whose move was refused", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: DAY_ID, end_id: DAY_ID } })),
      row(n("task-2", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
    ]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(window, { code: "Enter" });
    });

    expect(updateTask).not.toHaveBeenCalled();
    const first = document.querySelector('[data-plan-card-id="task-1"]');
    expect(first?.className).toContain("cardSelected");
  });

  it("walks to the next scope with ]", async () => {
    mockRows([row(n("task-1", "task"))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.keyDown(window, { code: "BracketRight" });
    });
    expect(getOrCreateScope).toHaveBeenCalledWith("week", "2026-09-27");
  });

  it("crosses to the other pane with the right arrow", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      row(n("task-2", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } })),
    ]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    fireEvent.keyDown(window, { code: "ArrowRight" });
    await act(async () => {
      fireEvent.keyDown(window, { code: "Enter" });
    });
    expect(updateTask).toHaveBeenCalledWith(2, { plan: null });
  });
});

/** The headings drawn inside a pane, in order. */
function headingsIn(pane: "candidates" | "planned"): string[] {
  const section = document.querySelector(`[data-plan-pane="${pane}"]`);
  if (section === null) throw new Error(`no ${pane} pane on screen`);
  return [...section.querySelectorAll("h3")].map((el) => el.textContent ?? "");
}

describe("grouping the candidates by path", () => {
  it("draws no header until the switch is on", async () => {
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }), [n("dom", "domain")])]);
    await renderPlanView();
    expect(document.querySelectorAll("[data-path-header]").length).toBe(0);
  });

  // The switch is the *candidates* pane's, and it groups that pane alone: the pane opposite is read
  // for when work is planned, which is the question its own menu answers.
  it("heads each run with its chain in the candidates pane once it is", async () => {
    const home = n("dom", "domain");
    useDisplayStore.setState({ planCandidatesPathGrouping: true });
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }), [home]),
      row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } }), [home]),
    ]);
    await renderPlanView();
    expect(document.querySelectorAll('[data-plan-pane="candidates"] [data-path-header]').length).toBe(1);
    expect(document.querySelectorAll('[data-plan-pane="planned"] [data-path-header]').length).toBe(0);
  });

  it("names the frame above a run that hangs straight off it, rather than leaving it the one unnamed run", async () => {
    useDisplayStore.setState({ planCandidatesPathGrouping: true });
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    const pane = document.querySelector('[data-plan-pane="candidates"]');
    expect(pane?.textContent).toContain("root");
  });

  it("takes the path off the card once a header carries it", async () => {
    const home = n("dom", "domain");
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }), [home])]);
    await renderPlanView();
    expect(document.querySelector('[data-plan-card-id="task-1"]')?.textContent).toContain("dom");

    await act(async () => { useDisplayStore.setState({ planCandidatesPathGrouping: true }); });
    expect(document.querySelector('[data-plan-card-id="task-1"]')?.textContent).not.toContain("dom");
  });
});

describe("the two kebab menus", () => {
  it("gives each half its own, and the window's settings popover neither", async () => {
    mockRows([]);
    await renderPlanView();
    expect(screen.getAllByLabelText("paneOptions")).toHaveLength(2);
  });

  it("opens the pass on what still needs placing, and nothing else", async () => {
    useDisplayStore.setState({ planCandidatesParentOnly: true });
    mockRows([
      // Unplanned and relevant — the pool, which is the same list however long the pass runs.
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      // Planned to this week itself while its days are what is being filled: still needs placing.
      row(n("task-2", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } })),
    ]);
    useDisplayStore.setState({ planSubscopeSplit: true });
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-2"]);

    await act(async () => { useDisplayStore.setState({ planCandidatesParentOnly: false }); });
    expect(cardsIn("candidates")).toEqual(["task-2", "task-1"]);
  });
});

describe("splitting the planned pane by subscope", () => {
  it("draws one section per day of the week being filled, empty ones included", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } }))]);
    await renderPlanView();
    // Sunday the 20th through Saturday the 26th: seven buckets, six of them empty.
    expect(headingsIn("planned")).toHaveLength(7);
    expect(headingsIn("planned")[0]).toContain("2026-09-20");
    expect(cardsIn("planned")).toEqual(["task-2"]);
  });

  it("leaves the candidates pane flat — the work waiting there sits in no subscope", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(headingsIn("candidates")).toEqual([]);
    expect(cardsIn("candidates")).toEqual(["task-1"]);
  });

  // The order the pane is *drawn* in is also the order the keyboard walks, so this is the test that
  // says Down does not jump between buckets: the triage hands these over late-then-early, and the
  // split has to put them back in calendar order.
  it("draws the pane in section order, not in the order the triage produced", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([
      row(n("task-late", "task", { plan: { start_id: LATER_DAY_ID, end_id: LATER_DAY_ID } })),
      row(n("task-early", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } })),
    ]);
    await renderPlanView();
    expect(cardsIn("planned")).toEqual(["task-early", "task-late"]);
  });

  // The catch-all section is gone. Work pinned to the scope while its parts are what you are
  // filling is work that still needs placing, and the side with the gestures is the left one.
  it("moves work planned to the scope itself to the candidates side, out of every section", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([
      row(n("task-loose", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } })),
    ]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-loose"]);
    expect(cardsIn("planned")).toEqual(["task-2"]);
  });

  it("offers no plan-into-this-scope while the parts are what is being filled", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-loose", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(screen.queryByLabelText("planInto")).toBeNull();
  });

  it("plans the selection into the subscope a number names", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-5", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-5"]);

    fireEvent.keyDown(window, { code: "ArrowDown" });
    await act(async () => { fireEvent.keyDown(window, { code: "Digit2" }); });
    await settle();
    // The second bucket of the week being filled is Monday the 21st.
    expect(getOrCreateScope).toHaveBeenCalledWith("day", "2026-09-21");
    expect(updateTask).toHaveBeenCalled();
  });

  it("plans by an unambiguous initial too, and leaves the colliding ones to their numbers", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-5", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    // W is Wednesday's alone; T and S each name two days of the week and so name none.
    await act(async () => { fireEvent.keyDown(window, { code: "KeyT" }); });
    await settle();
    expect(getOrCreateScope).not.toHaveBeenCalledWith("day", expect.anything());

    await act(async () => { fireEvent.keyDown(window, { code: "KeyW" }); });
    await settle();
    expect(getOrCreateScope).toHaveBeenCalledWith("day", "2026-09-23");
  });
});

describe("selecting more than one row", () => {
  const relevant = { start_id: WEEK_ID, end_id: WEEK_ID };

  it("extends the selection with Shift and plans the whole run in one go", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: relevant })),
      row(n("task-2", "task", { timeScope: relevant })),
      row(n("task-3", "task", { timeScope: relevant })),
    ]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    fireEvent.keyDown(window, { code: "ArrowDown", shiftKey: true });
    expect(document.querySelectorAll('[data-plan-pane="candidates"] [class*="cardSelected"]')).toHaveLength(2);

    await act(async () => { fireEvent.keyDown(window, { code: "Enter" }); });
    await settle();
    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(updateTask).toHaveBeenCalledWith(1, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
    expect(updateTask).toHaveBeenCalledWith(2, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
  });

  it("adds and removes one row at a time with Ctrl", async () => {
    mockRows([
      row(n("task-1", "task", { timeScope: relevant })),
      row(n("task-2", "task", { timeScope: relevant })),
      row(n("task-3", "task", { timeScope: relevant })),
    ]);
    await renderPlanView();

    fireEvent.click(screen.getByText("task-1"));
    fireEvent.click(screen.getByText("task-3"), { ctrlKey: true });
    await act(async () => { fireEvent.keyDown(window, { code: "Enter" }); });
    await settle();
    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(updateTask).toHaveBeenCalledWith(3, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
  });
});
