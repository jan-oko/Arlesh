import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PlanView from "./PlanView";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { ScopeRef } from "@/utils/scope-ref";
import { useListData } from "@/hooks/use-list-data";
import { clearScopeWindowCache } from "@/hooks/use-scope-windows";
import { clearScopeRowCache } from "@/hooks/use-scope-rows";
import { useDisplayStore } from "@/stores/use-display-store";
import { useViewStore } from "@/stores/use-view-store";
import { fixtureRowId } from "@/test/node-fixture";

// The usual key-for-string stub, with one exception: a bucket's keyboard mnemonic is the initial
// of its **rendered** name, so a stub that answered "planView:weekday.3" for Wednesday would give
// every day of the week the same initial and take every letter away.
// The names live inside the factory because `vi.mock` is hoisted above everything else in the file.
vi.mock("react-i18next", () => {
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    useTranslation: () => ({
      t: (key: string) => {
        const weekday = /^planView:weekday\.([0-6])$/.exec(key);
        return weekday === null ? key : weekdays[Number(weekday[1])] ?? key;
      },
    }),
  };
});

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
// The month the week sits in — its parent scope — and the season above that, the top of the ladder.
const MONTH_ID = 30;
const SEASON_ID = 40;
const WINDOWS: Record<number, { start: string; end: string }> = {
  [WEEK_ID]: { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" },
  [NEXT_WEEK_ID]: { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" },
  [DAY_ID]: { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" },
  [LATER_DAY_ID]: { start: "2026-09-24T00:00:00", end: "2026-09-25T00:00:00" },
  [MONTH_ID]: { start: "2026-09-01T00:00:00", end: "2026-10-01T00:00:00" },
  [SEASON_ID]: { start: "2026-09-01T00:00:00", end: "2026-12-01T00:00:00" },
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

const CONTAINMENT = {
  week_id: null, month_id: null, season_id: null, day_id: null, part: null,
  start_datetime: null, end_datetime: null,
};
const getOrCreateScope = vi.fn((kind: string, date: string) => {
  if (kind === "month") {
    return Promise.resolve({ id: MONTH_ID, kind: "month", label: "Sep", start_date: "2026-09-01", end_date: "2026-09-30", ...CONTAINMENT });
  }
  if (kind === "season") {
    return Promise.resolve({ id: SEASON_ID, kind: "season", label: "Autumn", start_date: "2026-09-01", end_date: "2026-11-30", ...CONTAINMENT });
  }
  return Promise.resolve({
    id: date === "2026-09-27" ? NEXT_WEEK_ID : WEEK_ID,
    kind: "week",
    label: "W39",
    start_date: date === "2026-09-27" ? "2026-09-27" : "2026-09-20",
    end_date: date === "2026-09-27" ? "2026-10-03" : "2026-09-26",
    ...CONTAINMENT,
  });
});
const resolveScope = vi.fn((id: number) =>
  Promise.resolve({ ...(WINDOWS[id] ?? { start: "", end: "" }), active: false }),
);
// `getOrCreateForRef` has to be stubbed alongside the two calls it dispatches to, not left to
// `importOriginal`. A partial mock replaces exports, not the bindings *inside* the real module — so
// the real `getOrCreateForRef` would keep calling the real get-or-create, reach for a Tauri host
// that is not there, and fail the scope the whole view is drawn against.
vi.mock("@/api/scopes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/scopes")>()),
  getOrCreateScope: (kind: string, date: string) => getOrCreateScope(kind, date),
  getOrCreatePartScope: (date: string, part: string) => getOrCreateScope(part, date),
  getOrCreateForRef: (ref: ScopeRef) => (
    ref.kind === "part_of_day"
      ? getOrCreateScope(ref.part, ref.date)
      : getOrCreateScope(ref.kind, "date" in ref ? ref.date : ref.start)
  ),
  resolveScope: (id: number) => resolveScope(id),
  getScope: (id: number) => getScope(id),
}));

const updateTask = vi.fn((_id: number, _request: unknown) => Promise.resolve());
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: (id: number, request: unknown) => updateTask(id, request),
}));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
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
    expectationRows: [],
    listRoot: n("root", "domain"),
    toggleRelease: vi.fn(),
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
  useViewStore.setState({ planScopeKind: "week" });
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
    await settle();
    expect(updateTask).toHaveBeenCalledWith(1, { plan: { start_id: WEEK_ID, end_id: WEEK_ID } });
    expect(reload).toHaveBeenCalled();
  });

  it("clears the Plan on the way back", async () => {
    mockRows([row(n("task-2", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("unplan"));
    });
    await settle();
    expect(updateTask).toHaveBeenCalledWith(2, { plan: null });
  });

  it("refuses a move that escapes the task's own Time Scope, and says which bound stopped it", async () => {
    mockRows([row(n("task-1", "task", { timeScope: { start_id: DAY_ID, end_id: DAY_ID } }))]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("planInto"));
    });
    await settle();
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("planView:refusedTimeScope")).toBeInTheDocument();
  });

  it("refuses a move that escapes the parent task's Plan", async () => {
    const parent = n("task-9", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } });
    mockRows([row(n("task-1", "task"), [parent])]);
    await renderPlanView();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("planInto"));
    });
    await settle();
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("planView:refusedParentPlan")).toBeInTheDocument();
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
    await settle();

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
    await settle();

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
    await settle();
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

  // As in the List View: a run with nothing above it has no chain to spell, and gets no header.
  it("draws no header over a run that hangs straight off the frame", async () => {
    useDisplayStore.setState({ planCandidatesPathGrouping: true });
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(document.querySelectorAll('[data-plan-pane="candidates"] [data-path-header]').length).toBe(0);
    expect(cardsIn("candidates")).toEqual(["task-1"]);
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

  // The switch hides the unplanned half and leaves the work committed to the parent scope — the
  // month the week sits in — which is what the pass opens on.
  it("opens the pass on the work planned to the parent scope, and shows the unplanned half once unticked", async () => {
    useDisplayStore.setState({ planCandidatesParentOnly: true });
    mockRows([
      // Unplanned and relevant — the pool, which is the same list however long the pass runs.
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      // Planned to the month above this week: committed a rung up, not yet placed here.
      row(n("task-3", "task", { plan: { start_id: MONTH_ID, end_id: MONTH_ID } })),
      // Planned to the season, two rungs up: not this pass's to place.
      row(n("task-4", "task", { plan: { start_id: SEASON_ID, end_id: SEASON_ID } })),
    ]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-3"]);

    await act(async () => { useDisplayStore.setState({ planCandidatesParentOnly: false }); });
    expect(cardsIn("candidates")).toEqual(["task-3", "task-1"]);
  });

  // With a parent present and nothing planned into it, an empty pane is the true answer.
  it("leaves the pane empty when the parent scope holds nothing", async () => {
    useDisplayStore.setState({ planCandidatesParentOnly: true });
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual([]);
  });

  // Work the split cannot place in a bucket is neither half: it is planned to the scope itself,
  // and the switch does not hide it.
  it("keeps work planned to the scope itself on the candidates side while it is split", async () => {
    useDisplayStore.setState({ planCandidatesParentOnly: true, planSubscopeSplit: true });
    mockRows([
      row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } })),
      row(n("task-2", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } })),
    ]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-2"]);
  });

  // A Season is the one top-level scope: there is no parent to have planned to, so the switch is
  // drawn inert and the pane shows the unplanned relevant work whatever it says.
  it("draws the switch inert for a Season, and shows the unplanned work regardless", async () => {
    useViewStore.setState({ planScopeKind: "season" });
    useDisplayStore.setState({ planCandidatesParentOnly: true });
    mockRows([row(n("task-1", "task", { timeScope: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();
    expect(cardsIn("candidates")).toEqual(["task-1"]);
    fireEvent.click(screen.getAllByLabelText("paneOptions")[0] ?? document.body);
    expect(screen.getByLabelText("planView:optionParentOnly")).toBeDisabled();
  });
});

describe("going up to the parent scope", () => {
  it("fills the month once Up is pressed on a week", async () => {
    mockRows([]);
    await renderPlanView();
    const up = screen.getByLabelText("upScope");
    expect(up).toBeEnabled();
    expect(up.parentElement).toHaveAttribute("title", "upScopeTo");

    await act(async () => { fireEvent.click(up); });
    await settle();
    expect(getOrCreateScope).toHaveBeenCalledWith("month", "2026-09-20");
    expect(useViewStore.getState().planScopeKind).toBe("month");
  });

  it("fills the month once \\ is pressed on a week, as the button does", async () => {
    mockRows([]);
    await renderPlanView();

    await act(async () => { fireEvent.keyDown(window, { code: "Backslash" }); });
    await settle();
    expect(getOrCreateScope).toHaveBeenCalledWith("month", "2026-09-20");
    expect(useViewStore.getState().planScopeKind).toBe("month");
  });

  // Where the button is disabled the key must not be a silent no-op: it says why, out loud.
  it("refuses \\ on a Season with the same reason the disabled button gives", async () => {
    useViewStore.setState({ planScopeKind: "season" });
    mockRows([]);
    await renderPlanView();

    await act(async () => { fireEvent.keyDown(window, { code: "Backslash" }); });
    expect(screen.getByText("planView:upScopeAtTop")).toBeInTheDocument();
    expect(useViewStore.getState().planScopeKind).toBe("season");
  });

  it("disables Up on a Season and says why on hover", async () => {
    useViewStore.setState({ planScopeKind: "season" });
    mockRows([]);
    await renderPlanView();
    const up = screen.getByLabelText("upScope");
    expect(up).toBeDisabled();
    expect(up.parentElement).toHaveAttribute("title", "upScopeAtTop");
  });
});

describe("switching the kind by its letter", () => {
  it.each([
    ["KeyS", "season"], ["KeyM", "month"], ["KeyW", "week"], ["KeyD", "day"], ["KeyP", "part_of_day"],
  ] as const)("%s fills the %s with nothing selected", async (code, kind) => {
    // Start from a month so W is a change too.
    useViewStore.setState({ planScopeKind: kind === "week" ? "month" : "week" });
    mockRows([]);
    await renderPlanView();

    await act(async () => { fireEvent.keyDown(window, { code }); });
    await settle();
    expect(useViewStore.getState().planScopeKind).toBe(kind);
  });

  // Coarser lands on the scope holding the current one's first day — the week's month.
  it("lands M on the month holding the week's first day", async () => {
    mockRows([]);
    await renderPlanView();
    await act(async () => { fireEvent.keyDown(window, { code: "KeyM" }); });
    await settle();
    expect(getOrCreateScope).toHaveBeenCalledWith("month", "2026-09-20");
  });

  // With a row selected the letter is the subscope mnemonic's: M plans into Monday.
  it("leaves M to the subscope mnemonic while a row is selected", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-5", "task", { plan: { start_id: WEEK_ID, end_id: WEEK_ID } }))]);
    await renderPlanView();

    fireEvent.keyDown(window, { code: "ArrowDown" });
    await act(async () => { fireEvent.keyDown(window, { code: "KeyM" }); });
    await settle();
    expect(useViewStore.getState().planScopeKind).toBe("week");
    expect(getOrCreateScope).toHaveBeenCalledWith("day", "2026-09-21");
  });

  it("does nothing while a text field has the keyboard", async () => {
    mockRows([]);
    await renderPlanView();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    await act(async () => { fireEvent.keyDown(field, { code: "KeyM" }); });
    expect(useViewStore.getState().planScopeKind).toBe("week");
    field.remove();
  });

  it("does nothing while the kind dropdown is open", async () => {
    mockRows([]);
    await renderPlanView();
    await act(async () => { fireEvent.click(screen.getByLabelText("scopeKind")); });

    await act(async () => { fireEvent.keyDown(window, { code: "KeyM" }); });
    expect(useViewStore.getState().planScopeKind).toBe("week");
  });
});

describe("splitting the planned pane by subscope", () => {
  it("draws one section per day of the week being filled, empty ones included", async () => {
    useDisplayStore.setState({ planSubscopeSplit: true });
    mockRows([row(n("task-2", "task", { plan: { start_id: DAY_ID, end_id: DAY_ID } }))]);
    await renderPlanView();
    // Sunday the 20th through Saturday the 26th: seven buckets, six of them empty.
    expect(headingsIn("planned")).toHaveLength(7);
    expect(headingsIn("planned")[0]).toContain("Sunday");
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
