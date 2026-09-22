import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TopBar from "./TopBar";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";
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
  antecedentPool: [], dependencyPool: [],
  displayTaskStatus: (v: string) => v, displayGoalStatus: (v: string) => v,
  displayProjectStatus: (v: string) => v, displayVerdict: (v: string) => v,
  displayScopeState: (v: string) => v, displayBlocked: (v: string) => v,
  displayAgentic: (v: string) => v,
  displayAsynchronous: (v: string) => v,
};

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal" });
  useDisplayStore.setState({ pathHeaderIcons: true, asynchronousFirst: false });
  useThemeStore.setState({ theme: "dark" });
  useCloseToTrayStore.setState({ closeToTray: true });
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

/** Inside `Arlesh › … › Project X › CODE`, which is enough chain to tell the ends apart. */
function enterCODE() {
  useMindmapStore.setState({
    subtreeRootId: "goal-1",
    subtreeNav: {
      ancestors: [{ id: null, title: "Arlesh" }, { id: "domain-2", title: "Project X" }],
      currentTitle: "CODE",
    },
  });
}

describe("TopBar", () => {
  it("renders the settings and filter buttons, and no breadcrumb at the root", () => {
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "common:settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("draws the breadcrumb from the store when inside a subtree", () => {
    enterCODE();
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "Arlesh" })).toBeInTheDocument(); // the true root
    expect(screen.getByRole("button", { name: "Project X" })).toBeInTheDocument(); // the level above
    expect(screen.getByText("CODE")).toBeInTheDocument(); // where you are
  });

  it("names the landmark, so the chain is not heard as a run of bare titles", () => {
    enterCODE();
    render(<TopBar />);
    expect(screen.getByRole("navigation", { name: "insideSubtree" })).toBeInTheDocument();
  });

  it("leaves the last segment plain — 'here' has nowhere to navigate to", () => {
    enterCODE();
    render(<TopBar />);
    expect(screen.queryByRole("button", { name: "CODE" })).not.toBeInTheDocument();
  });

  it("shows nothing at all at the true root", () => {
    render(<TopBar />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
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

    it("turns close-to-tray off from its switch, which starts on", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      const traySwitch = screen.getByRole("checkbox", { name: "common:closeToTray" });
      expect(traySwitch).toBeChecked();
      fireEvent.click(traySwitch);
      expect(useCloseToTrayStore.getState().closeToTray).toBe(false);
      expect(traySwitch).not.toBeChecked();
    });

    it("offers the close-to-tray switch in List View too, since the close button is view-agnostic", () => {
      useViewStore.setState({ view: "list" });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.getByRole("checkbox", { name: "common:closeToTray" })).toBeInTheDocument();
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
      expect(useDisplayStore.getState().pathHeaderIcons).toBe(false);
      expect(iconSwitch).not.toBeChecked();
    });

    it("hides the Path icons switch on the Mindmap, which has no path headers", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.queryByRole("checkbox", { name: "common:pathIcons" })).not.toBeInTheDocument();
    });

    it("turns Asynchronous first on from a switch that starts off", () => {
      // Off by default: row order is something the tree already answers, and rearranging it for
      // everyone would be a change nobody asked for.
      useViewStore.setState({ view: "list" });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      const asyncSwitch = screen.getByRole("checkbox", { name: "common:asynchronousFirst" });
      expect(asyncSwitch).not.toBeChecked();
      fireEvent.click(asyncSwitch);
      expect(useDisplayStore.getState().asynchronousFirst).toBe(true);
      expect(asyncSwitch).toBeChecked();
    });

    it("hides Asynchronous first on the Mindmap, whose sibling order is set by hand", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.queryByRole("checkbox", { name: "common:asynchronousFirst" })).not.toBeInTheDocument();
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

describe("the habit-history collapse threshold", () => {
  function openSettings() {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
  }

  it("shows the current threshold in the settings popover", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 5 });
    openSettings();
    expect(screen.getByLabelText("collapse.thresholdLabel")).toHaveValue(5);
  });

  it("stores a new threshold once the field is left", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 3 });
    openSettings();
    const field = screen.getByLabelText("collapse.thresholdLabel");
    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.blur(field);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(7);
  });

  it("refuses a threshold below two — one iteration is not a run", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 3 });
    openSettings();
    const field = screen.getByLabelText("collapse.thresholdLabel");
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.blur(field);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(2);
  });

  it("keeps the old threshold when the field is left empty", () => {
    useDisplayStore.setState({ habitCollapseThreshold: 4 });
    openSettings();
    const field = screen.getByLabelText("collapse.thresholdLabel");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(4);
  });

  it("stays out of List View, which draws no mindmap nodes to fold", () => {
    useViewStore.setState({ view: "list", mindmapOrientation: "horizontal" });
    openSettings();
    expect(screen.queryByLabelText("collapse.thresholdLabel")).not.toBeInTheDocument();
  });
});
