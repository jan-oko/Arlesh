import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import StepsView from "./StepsView";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { fixtureRowId } from "@/test/node-fixture";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/MindmapView/use-mindmap-data");
vi.mock("@/components/NodeEditorModals/NodeEditorModals", () => ({ default: () => null }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));
vi.mock("@/components/MindmapView/use-node-editor", () => ({
  useNodeEditor: () => ({
    editorModal: null, setEditorModal: vi.fn(), allTags: [], domainNames: new Map(), availableForDep: [],
  }),
}));
// A measured area two cards across and one down, so five cards fill three pages of two.
vi.mock("./use-step-grid", () => ({
  useStepGrid: () => ({ ref: { current: null }, grid: { columns: 2, rows: 1, pageSize: 2 } }),
}));

function n(id: string, kind: NodeKind): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [] };
}

function mockTree(children: MindmapNode[]): void {
  vi.mocked(useMindmapData).mockReturnValue({
    tree: { ...n("root", "domain"), children },
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    reload: vi.fn(() => Promise.resolve()),
    createNode: vi.fn(),
    createChild: vi.fn(),
    renameNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    removeNode: vi.fn(),
    createCommitment: vi.fn(),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
  });
}

/** The child cards drawn on the page shown — the header card left out. */
function pageCards(): string[] {
  return [...document.querySelectorAll("[data-step-card]")]
    .map((el) => el.getAttribute("data-step-card") ?? "")
    .filter((id) => id !== "goal-1");
}

function selectedCardId(): string | null {
  return document.querySelector('[data-step-card][aria-current="true"]')?.getAttribute("data-step-card") ?? null;
}

function press(code: string): void {
  act(() => { fireEvent.keyDown(window, { code }); });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useMindmapStore.setState({ subtreeRootId: "goal-1", pendingToast: null, searchOpen: false });
  useViewStore.setState({ stepsZoom: 3 });
  const tasks = [1, 2, 3, 4, 5].map((index) => n(`task-${index}`, "task"));
  mockTree([{ ...n("goal-1", "goal"), children: tasks }]);
});

describe("turning a Step's pages", () => {
  it("turns with ] and [ as with PageDown and PageUp", () => {
    render(<StepsView />);
    expect(pageCards()).toEqual(["task-1", "task-2"]);

    press("BracketRight");
    expect(pageCards()).toEqual(["task-3", "task-4"]);
    expect(selectedCardId()).toBe("task-3");
    press("BracketRight");
    expect(pageCards()).toEqual(["task-5"]);

    press("BracketLeft");
    expect(pageCards()).toEqual(["task-3", "task-4"]);
    press("PageUp");
    expect(pageCards()).toEqual(["task-1", "task-2"]);
  });
});

describe("the arrows at a page's edge", () => {
  it("carry → off the page's last card onto the next page's first", () => {
    render(<StepsView />);
    press("ArrowDown");
    press("ArrowRight");
    expect(selectedCardId()).toBe("task-2");

    press("ArrowRight");
    expect(pageCards()).toEqual(["task-3", "task-4"]);
    expect(selectedCardId()).toBe("task-3");
  });

  it("carry ← off the page's first card onto the previous page's last", () => {
    render(<StepsView />);
    press("BracketRight");
    press("BracketRight");
    expect(selectedCardId()).toBe("task-5");

    press("ArrowLeft");
    expect(pageCards()).toEqual(["task-3", "task-4"]);
    expect(selectedCardId()).toBe("task-4");
  });

  it("stop at the last card of the whole Step", () => {
    render(<StepsView />);
    press("BracketRight");
    press("BracketRight");
    press("ArrowRight");
    expect(selectedCardId()).toBe("task-5");
  });
});
