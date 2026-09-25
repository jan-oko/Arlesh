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

  it("switches to List View when it is picked from the view dropdown", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "common:viewSelectorLabel" }));
    fireEvent.click(screen.getByRole("option", { name: "common:viewList" }));
    expect(useViewStore.getState().view).toBe("list");
  });

  it("shows the active view as the dropdown's value", () => {
    useViewStore.setState({ view: "list" });
    render(<TopBar />);
    const trigger = screen.getByRole("button", { name: "common:viewSelectorLabel" });
    expect(trigger.textContent).toContain("common:viewList");
  });

  it("offers every view, so a fifth is a union member and not another button", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "common:viewSelectorLabel" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "common:viewMindmap", "common:viewList", "common:viewPlan", "common:viewSteps",
    ]);
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

  describe("the gear", () => {
    it("opens the settings modal, and its close button shuts it", () => {
      render(<TopBar />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));
      expect(screen.getByRole("dialog", { name: "title" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes the modal on Escape", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "common:settings" }));

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
