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
const WINDOWS: Record<number, { start: string; end: string }> = {
  [WEEK_ID]: { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" },
  [NEXT_WEEK_ID]: { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" },
  [DAY_ID]: { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" },
};

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
    dependencyRefs: [], isBlocked: false, isAgentic: false,
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
    renameNode: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    removeNode: vi.fn(),
  });
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
