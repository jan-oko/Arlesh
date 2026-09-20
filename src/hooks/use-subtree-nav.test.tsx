import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook, act, fireEvent } from "@testing-library/react";
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

  it("names the subtree you are in and the true root above it", () => {
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      ancestors: [{ id: null, title: "Arlesh" }],
      currentTitle: "CODE",
    });
  });

  it("publishes the whole chain, root first, when nested", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav).toEqual({
      ancestors: [{ id: null, title: "Arlesh" }, { id: "project-1", title: "CODE" }],
      currentTitle: "Deeper",
    });
  });

  it("gives the true root no id, since it is nobody's subtree", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    renderHook(() => useSubtreeNav(TREE));
    expect(useMindmapStore.getState().subtreeNav?.ancestors[0]?.id).toBeNull();
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
 * That is what makes the breadcrumb appear in the Mindmap as well as the List View.
 */
function Harness() {
  useSubtreeNav(TREE);
  return <TopBar />;
}

describe("the top bar's breadcrumb, fed by a mounted view", () => {
  it("shows nothing at the true root", () => {
    render(<Harness />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("names the current subtree once a view has entered one", () => {
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    render(<Harness />);
    expect(screen.getByText("CODE")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "insideSubtree" })).toBeInTheDocument();
  });

  it("draws the whole chain, every ancestor a way out and the last step plain text", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    render(<Harness />);
    expect(screen.getByText("Deeper")).toBeInTheDocument(); // where you are
    expect(screen.getByRole("button", { name: "CODE" })).toBeInTheDocument(); // up one level
    expect(screen.getByRole("button", { name: "Arlesh" })).toBeInTheDocument(); // out to the root
    expect(screen.queryByRole("button", { name: "Deeper" })).not.toBeInTheDocument();
  });

  it("exits to the ancestor whose segment is clicked, not merely one level", () => {
    useMindmapStore.setState({ subtreeRootId: "project-2" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Arlesh" }));
    expect(useMindmapStore.getState().subtreeRootId).toBeNull();
  });
});
