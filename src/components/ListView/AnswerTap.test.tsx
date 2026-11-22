import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ListView from "./ListView";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useListData } from "@/hooks/use-list-data";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import type { TaskListRow } from "@/utils/list-filter";
import { TOUCH_QUERY } from "@/hooks/use-media-query";
import type { MindmapNode } from "@/utils/tree-layout";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-list-data");
const held = vi.hoisted(() => ({ actions: undefined as import("@/hooks/use-answer-drafts").AnswerActions | undefined }));
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
    answers: held.actions,
  }),
}));
vi.mock("@/components/TaskEditorModal/TaskEditorModal", () => ({ default: () => null }));
vi.mock("@/components/CommitmentEditorModal/CommitmentEditorModal", () => ({ default: () => null }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

function ListViewInApp() {
  useGlobalHotkeys();
  return <ListView />;
}

const question: MindmapNode = {
  id: "expectation-2", rowId: storedRowId(2), kind: "expectation", title: "Proceed?", status: "pending", position: 0, tagIds: [], children: [],
  agentWaiting: { note: null, question: true, answer: null },
};

const reviewWait: MindmapNode = {
  ...question,
  id: "expectation-3", rowId: storedRowId(3), title: "Review #12",
  agentWaiting: { note: null, question: true, answer: null, review: { links: [], hand_tests: [] } },
};

function taskHolding(wait: MindmapNode): MindmapNode {
  return {
    id: "task-1", rowId: storedRowId(1), kind: "task", title: "Work", position: 0, tagIds: [], children: [],
    status: "todo", taskStatus: { kind: "agentic", status: "review" },
    agentWaits: [wait], openQuestionIds: [wait.rowId ?? ""], stagedQuestionIds: [],
  };
}


function row(node: MindmapNode): TaskListRow {
  return {
    node,
    ancestors: [],
    goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, isAgentic: true, isAsynchronous: false,
    heldByBlockedAncestor: false, hasPrivateAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
  };
}

/**
 * A finger tap as a touch screen delivers it: pointer and touch events, then the click the browser
 * synthesises, unless something cancelled the `touchend` (it then takes the click with it).
 */
function tap(target: Element): void {
  const at = { target, clientX: 10, clientY: 10 };
  fireEvent.pointerDown(target, { pointerType: "touch" });
  fireEvent.touchStart(target, { touches: [at] });
  fireEvent.pointerUp(target, { pointerType: "touch" });
  const notCancelled = fireEvent.touchEnd(target, { touches: [], changedTouches: [at] });
  if (notCancelled) fireEvent.click(target);
}

/** The List View over one Task holding `wait` as an open question of the agent's. */
function showTask(wait: MindmapNode): void {
  const task = taskHolding(wait);
  vi.mocked(useListData).mockReturnValue({
      tree: { id: "root", kind: "domain", title: "root", position: 0, tagIds: [], children: [task] },
      rows: [row(task)], commitmentRows: [], expectationRows: [], listRoot: task,
      toggleRelease: vi.fn(), allTasksAndGoals: [], isLoading: false, error: null, settle: vi.fn(),
      onCycleStatus: vi.fn(), onToggleStarted: vi.fn(), renameNode: vi.fn(), createTask: vi.fn(), deleteTask: vi.fn(),
      removeNode: vi.fn(), occurrencePrompt: null, confirmOccurrence: vi.fn(), cancelOccurrence: vi.fn(),
    } as unknown as ReturnType<typeof useListData>);
}

let actions = answerActions();

describe("List row on a phone: tapping the answer controls", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === TOUCH_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    actions = answerActions();
    held.actions = actions;
    useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
    showTask(question);
  });
  afterEach(() => vi.unstubAllGlobals());

  function typeAnswer(): void {
    const field = screen.getByPlaceholderText("answerHint");
    field.focus();
    fireEvent.change(field, { target: { value: "Yes" } });
  }

  it("Send sends the typed answer", () => {
    render(<ListViewInApp />);
    typeAnswer();
    tap(screen.getByRole("button", { name: "answerSend" }));
    return waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
  });

  it("Stage stages the typed answer", () => {
    render(<ListViewInApp />);
    typeAnswer();
    tap(screen.getByRole("button", { name: "answerStage" }));
    return waitFor(() => expect(actions.stage).toHaveBeenCalledTimes(1));
  });

  it("a review's verdict switch and Send answer a tap", async () => {
    showTask(reviewWait);
    render(<ListViewInApp />);
    tap(screen.getByRole("radio", { name: "reviewApprove" }));
    expect(screen.getByRole("radio", { name: "reviewApprove" })).toHaveAttribute("aria-checked", "true");
    tap(screen.getByRole("button", { name: "answerSend" }));
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
  });

  it("still reads a tap on the row's own surface as the row's gesture, not a click", () => {
    render(<ListViewInApp />);
    const clicked = vi.fn();
    const surface = screen.getByText("Proceed?");
    surface.addEventListener("click", clicked);
    tap(surface);
    expect(clicked).not.toHaveBeenCalled();
  });
});
