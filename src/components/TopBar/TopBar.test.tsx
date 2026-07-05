import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TopBar from "./TopBar";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/hooks/use-filter-display");

const mockUseFilterDisplay = vi.mocked(useFilterDisplay);

const EMPTY_DISPLAY = {
  tagOptions: [], tagName: (id: number) => `#${id}`, tagColor: () => null,
  nodeLabel: (ref: string) => ref, nodeColor: () => null,
  parentPool: [], dependencyPool: [],
  displayTaskStatus: (v: string) => v, displayGoalStatus: (v: string) => v,
  displayProjectStatus: (v: string) => v, displayScopeState: (v: string) => v, displayBlocked: (v: string) => v,
};

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useViewStore.setState({ view: "mindmap" });
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

describe("TopBar", () => {
  it("renders the settings and filter buttons, no back pills at root", () => {
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "common:settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
    expect(screen.queryByText("Parent")).not.toBeInTheDocument();
  });

  it("shows back-nav pills from the store when inside a subtree", () => {
    useMindmapStore.setState({
      subtreeRootId: "goal-1",
      subtreeNav: { rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.getByText("Project X")).toBeInTheDocument(); // back one level
    expect(screen.getByText("Arlesh")).toBeInTheDocument(); // back to root (parentSubtreeId != null)
  });

  it("switches to List View when its tab is clicked", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByText("common:viewList"));
    expect(useViewStore.getState().view).toBe("list");
  });

  it("marks the active view's tab", () => {
    useViewStore.setState({ view: "list" });
    const { container } = render(<TopBar />);
    const activeTab = container.querySelector("[class*='viewTabActive']");
    expect(activeTab?.textContent).toBe("common:viewList");
  });

  describe("status preset dropdown", () => {
    it("offers only All/Plan/Start/Do in Mindmap view", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      expect(options).toEqual(["listView:preset.all", "listView:preset.plan", "listView:preset.start", "listView:preset.do"]);
    });

    it("adds Unblock as a 5th option in List View", () => {
      useViewStore.setState({ view: "list" });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      expect(options).toContain("listView:preset.unblock");
    });

    it("selecting Plan writes through to the shared status mode and the list preset", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      fireEvent.click(screen.getByRole("option", { name: "listView:preset.plan" }));
      expect(useFilterStore.getState().filter.statusMode).toBe("plan");
      expect(useListFilterStore.getState().filter.preset).toBe("plan");
    });

    it("selecting Unblock does not touch the shared status mode", () => {
      useViewStore.setState({ view: "list" });
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      fireEvent.click(screen.getByRole("option", { name: "listView:preset.unblock" }));
      expect(useFilterStore.getState().filter.statusMode).toBe("do");
      expect(useListFilterStore.getState().filter.preset).toBe("unblock");
    });

    it("reflects Unblock as the selected value only while List View is active", () => {
      useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "unblock" } });
      useViewStore.setState({ view: "mindmap" });
      const { rerender } = render(<TopBar />);
      expect(screen.getByRole("button", { name: "listView:statusPresetLabel" })).toHaveTextContent("listView:preset.all");
      useViewStore.setState({ view: "list" });
      rerender(<TopBar />);
      expect(screen.getByRole("button", { name: "listView:statusPresetLabel" })).toHaveTextContent("listView:preset.unblock");
    });
  });

  describe("active filter chips", () => {
    it("shows a chip for an active shared tag filter", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 1, mode: "any" }] } });
      mockUseFilterDisplay.mockReturnValue({ ...EMPTY_DISPLAY, tagName: () => "urgent" });
      render(<TopBar />);
      expect(screen.getByText("urgent")).toBeInTheDocument();
    });
  });
});
