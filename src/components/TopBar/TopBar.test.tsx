import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TopBar from "./TopBar";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";

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
};

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal", pathHeaderIcons: true });
  useThemeStore.setState({ theme: "dark" });
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
      subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.getByText("Project X")).toBeInTheDocument(); // back one level
    expect(screen.getByText("Arlesh")).toBeInTheDocument(); // back to root (parentSubtreeId != null)
  });

  it("names the subtree you are currently inside", () => {
    useMindmapStore.setState({
      subtreeRootId: "goal-1",
      subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.getByText("CODE")).toBeInTheDocument();
  });

  it("gives the indicator a spoken label, so it is not a third bare title in a row", () => {
    useMindmapStore.setState({
      subtreeRootId: "goal-1",
      subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.getByText("common:insideSubtree")).toBeInTheDocument();
  });

  it("the indicator is not a button — the other two pills are the ways out, this one is where you are", () => {
    useMindmapStore.setState({
      subtreeRootId: "goal-1",
      subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.queryByRole("button", { name: /CODE/ })).not.toBeInTheDocument();
  });

  it("shows no subtree indicator at the true root", () => {
    render(<TopBar />);
    expect(screen.queryByText("common:insideSubtree")).not.toBeInTheDocument();
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
    it("offers every preset but Unblock in Mindmap view", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      // Backlog is available in both views; only Unblock is List-View-only.
      expect(options).toEqual([
        "listView:preset.all", "listView:preset.plan", "listView:preset.start",
        "listView:preset.do", "listView:preset.backlog",
      ]);
    });

    it("selecting Backlog writes through to the shared status mode", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
      fireEvent.click(screen.getByRole("option", { name: "listView:preset.backlog" }));
      expect(useFilterStore.getState().filter.statusMode).toBe("backlog");
      expect(useListFilterStore.getState().filter.preset).toBe("backlog");
    });

    it("adds Unblock as a further option in List View", () => {
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

  describe("settings popover", () => {
    it("toggles the theme via the Light mode switch", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      const themeSwitch = screen.getByRole("checkbox", { name: "common:lightMode" });
      expect(themeSwitch).not.toBeChecked();
      fireEvent.click(themeSwitch);
      expect(useThemeStore.getState().theme).toBe("light");
      expect(themeSwitch).toBeChecked();
    });

    it("flips the mindmap orientation from the vertical-layout switch", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      const orientationSwitch = screen.getByRole("checkbox", { name: "common:verticalLayout" });
      expect(orientationSwitch).not.toBeChecked();
      fireEvent.click(orientationSwitch);
      expect(useViewStore.getState().mindmapOrientation).toBe("vertical");
      expect(orientationSwitch).toBeChecked();
    });

    it("hides the vertical-layout switch in List View, where it has no meaning", () => {
      useViewStore.setState({ view: "list" });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.queryByRole("checkbox", { name: "common:verticalLayout" })).not.toBeInTheDocument();
    });

    it("turns path-header glyphs off from the Path icons switch, which starts on", () => {
      useViewStore.setState({ view: "list" });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      const iconSwitch = screen.getByRole("checkbox", { name: "common:pathIcons" });
      expect(iconSwitch).toBeChecked();
      fireEvent.click(iconSwitch);
      expect(useViewStore.getState().pathHeaderIcons).toBe(false);
      expect(iconSwitch).not.toBeChecked();
    });

    it("hides the Path icons switch on the Mindmap, which has no path headers", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.queryByRole("checkbox", { name: "common:pathIcons" })).not.toBeInTheDocument();
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
