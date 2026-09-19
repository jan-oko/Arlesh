import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook, act } from "@testing-library/react";
import { useSubtreeNav } from "./use-subtree-nav";
import TopBar from "@/components/TopBar/TopBar";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-filter-display");

const mockUseFilterDisplay = vi.mocked(useFilterDisplay);

const EMPTY_DISPLAY = {
  tagOptions: [], tagName: (id: number) => `#${id}`, tagColor: () => null,
  nodeLabel: (ref: string) => ref, nodeColor: () => null,
  parentPool: [], dependencyPool: [],
  displayTaskStatus: (v: string) => v, displayGoalStatus: (v: string) => v,
  displayProjectStatus: (v: string) => v, displayVerdict: (v: string) => v,
  displayScopeState: (v: string) => v, displayBlocked: (v: string) => v,
  displayAgentic: (v: string) => v,
};

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

/** Arlesh ▸ CODE ▸ Deeper — two levels, so "up one" and "to the root" differ. */
const TREE = n("root", "domain", { title: "Arlesh" }, [
  n("project-1", "project", { title: "CODE" }, [n("project-2", "project", { title: "Deeper" })]),
]);

beforeEach(() => {
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal" });
  useThemeStore.setState({ theme: "dark" });
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

/**
 * A tab's subtree root comes back from storage, so the node it names may have been deleted in the
 * meantime. A view rooted at a node that is not there shows nothing, with no indicator and no pill
 * to escape by — so it falls back to the true root instead.
 */
describe("a subtree root that is no longer on the board", () => {
  it("falls back to the true root", () => {
    useMindmapStore.setState({ subtreeRootId: "deleted-node" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeRootId).toBeNull();
  });

  it("leaves a root that does exist alone", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeRootId).toBe("project-2");
  });

  it("waits for a loaded tree rather than reading an empty one as a deletion", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    renderHook(() => useSubtreeNav(n("root", "domain", { title: "Arlesh" })));
    expect(useMindmapStore.getState().subtreeRootId).toBe("project-2");
  });
});

describe("useSubtreeNav", () => {
  it("publishes nothing at the true root", () => {
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav).toBeNull();
  });

  it("names the subtree you are in, the root, and the level above it", () => {
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      currentTitle: "CODE",
      rootTitle: "Arlesh",
      parentTitle: "Arlesh",
      parentSubtreeId: null,
    });
  });

  it("points one level up at the enclosing subtree, not the root, when nested", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      currentTitle: "Deeper",
      rootTitle: "Arlesh",
      parentTitle: "CODE",
      parentSubtreeId: "project-1",
    });
  });

  it("exits one level at a time, then out to the root", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    const { result, rerender } = renderHook(() => useSubtreeNav(TREE));
    act(() => { result.current.onExitSubtree(); });
    expect(useMindmapStore.getState().subtreeRootId).toBe("project-1");
    rerender();
    act(() => { result.current.onExitToRoot(); });
    expect(useMindmapStore.getState().subtreeRootId).toBeNull();
  });
});

/**
 * The top bar holds no tree, so it can only show where you are if the mounted view publishes it.
 * `MindmapView` and `ListView` both do that by calling this hook and nothing else — so a harness
 * that calls the hook alongside the real `TopBar` exercises the identical path either view takes.
 * That is what makes the indicator appear in the Mindmap as well as the List View.
 */
function Harness() {
  useSubtreeNav(TREE);
  return <TopBar />;
}

describe("the top bar's subtree indicator, fed by a mounted view", () => {
  it("shows nothing at the true root", () => {
    render(<Harness />);
    expect(screen.queryByText("common:insideSubtree")).not.toBeInTheDocument();
  });

  it("names the current subtree once a view has entered one", () => {
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    render(<Harness />);
    expect(screen.getByText("CODE")).toBeInTheDocument();
    expect(screen.getByText("common:insideSubtree")).toBeInTheDocument();
  });

  it("shows the current subtree alongside, and distinct from, the two ways back out", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    render(<Harness />);
    expect(screen.getByText("Deeper")).toBeInTheDocument(); // where you are
    expect(screen.getByRole("button", { name: /CODE/ })).toBeInTheDocument(); // up one level
    expect(screen.getByRole("button", { name: /Arlesh/ })).toBeInTheDocument(); // out to the root
    expect(screen.queryByRole("button", { name: /Deeper/ })).not.toBeInTheDocument();
  });
});
