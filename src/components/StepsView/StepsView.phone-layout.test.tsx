import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import StepsView from "./StepsView";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { PHONE_LAYOUT_QUERY } from "@/hooks/use-media-query";
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
// A measured area that holds three rows at the card size.
vi.mock("./use-step-grid", () => ({
  useStepGrid: () => ({ ref: { current: null }, grid: { columns: 2, rows: 3, pageSize: 6 } }),
}));

function n(id: string, kind: NodeKind): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [] };
}

function mockTree(count: number): void {
  const children = Array.from({ length: count }, (_, i) => n(`task-${i + 1}`, "task"));
  vi.mocked(useMindmapData).mockReturnValue({
    tree: { ...n("root", "domain"), children },
    isLoading: false,
    error: null,
    loadCondition: { failedFlows: [], unrenderableCommitmentFlows: [] },
    reload: vi.fn(() => Promise.resolve()),
    createNode: vi.fn(),
    createChild: vi.fn(),
    settleCreated: vi.fn((created: MindmapNode) => Promise.resolve(created)),
    renameNode: vi.fn(),
    reorderNode: vi.fn(),
    moveNode: vi.fn(),
    duplicateNode: vi.fn(),
    pasteNodes: vi.fn().mockResolvedValue([]),
    insertParent: vi.fn().mockResolvedValue("domain-99"),
    removeNode: vi.fn(),
    createCommitment: vi.fn(),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
  });
}

function childArea(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="group"]');
}

function drawnChildren(): number {
  return document.querySelectorAll("[data-step-card]").length - 1;
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useMindmapStore.setState({ subtreeRootId: null, pendingToast: null, searchOpen: false, selectedNodeId: null, selectedNodeIds: new Set() });
  useViewStore.setState({ stepsZoom: 3 });
  useDisplayStore.setState({ stepsFillScreen: true });
});

describe("the display setting", () => {
  it("fills the screen unless turned off", () => {
    expect(useDisplayStore.getState().stepsFillScreen).toBe(true);
    useDisplayStore.getState().toggleStepsFillScreen();
    expect(useDisplayStore.getState().stepsFillScreen).toBe(false);
  });

  it("is stored with the other display settings, so it survives a restart", () => {
    useDisplayStore.getState().toggleStepsFillScreen();
    const stored = JSON.parse(localStorage.getItem("arlesh-display") ?? "{}") as { state?: { stepsFillScreen?: boolean } };
    expect(stored.state?.stepsFillScreen).toBe(false);
  });
});

describe("on the desktop", () => {
  it("keeps the paged grid whatever the setting says", () => {
    mockTree(8);
    useDisplayStore.setState({ stepsFillScreen: false });
    render(<StepsView />);
    expect(childArea()?.getAttribute("data-phone-layout")).toBeNull();
    expect(drawnChildren()).toBe(6);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === PHONE_LAYOUT_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills the screen by default with every card in one column and no pager: the column scrolls instead", () => {
    mockTree(8);
    render(<StepsView />);
    const area = childArea();
    expect(area?.getAttribute("data-phone-layout")).toBe("fill");
    expect(area?.style.getPropertyValue("--step-rows") || area?.parentElement?.style.getPropertyValue("--step-rows")).toBe("8");
    expect(drawnChildren()).toBe(8);
    expect(document.querySelector("[class*='pager']")).toBeNull();
  });

  it("draws one scrolling column holding every card when the setting is off", () => {
    mockTree(8);
    useDisplayStore.setState({ stepsFillScreen: false });
    render(<StepsView />);
    expect(childArea()?.getAttribute("data-phone-layout")).toBe("scroll");
    expect(drawnChildren()).toBe(8);
  });
});
