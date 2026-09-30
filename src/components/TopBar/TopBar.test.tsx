import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TopBar from "./TopBar";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";
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
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER }, searchOpen: false, popoverOpen: false });
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
  it("draws the Ctrl+F filter search while it is open, and closes it on Esc", () => {
    useFilterStore.setState({ searchOpen: true });
    render(<TopBar />);
    const box = screen.getByRole("combobox", { name: "search.dialogLabel" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(useFilterStore.getState().searchOpen).toBe(false);
    expect(screen.queryByRole("combobox", { name: "search.dialogLabel" })).not.toBeInTheDocument();
  });

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
      "common:viewMindmap", "common:viewList", "common:viewPlan", "common:viewSteps", "common:viewZen",
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

    it("shows Plan active and every other preset disabled while the Plan View is active", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      useViewStore.setState({ view: "plan" });
      render(<TopBar />);
      const trigger = screen.getByRole("button", { name: "listView:statusPresetLabel" });
      expect(trigger).toHaveTextContent("listView:preset.plan");
      expect(trigger).toHaveAttribute("title", "planView:presetLocked");

      fireEvent.click(trigger);
      const plan = screen.getByRole("option", { name: "listView:preset.plan" });
      expect(plan).not.toHaveAttribute("aria-disabled");
      for (const preset of ["all", "start", "do", "backlog"]) {
        const option = screen.getByRole("option", { name: `listView:preset.${preset}` });
        expect(option).toHaveAttribute("aria-disabled", "true");
        expect(option).toHaveAttribute("title", "planView:presetLocked");
      }

      fireEvent.click(screen.getByRole("option", { name: "listView:preset.all" }));
      expect(useFilterStore.getState().filter.statusMode).toBe("do");
    });

    it("shows Do active and every other preset disabled while the Zen View is active, without writing Do", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "start" } });
      useViewStore.setState({ view: "zen" });
      render(<TopBar />);
      const trigger = screen.getByRole("button", { name: "listView:statusPresetLabel" });
      expect(trigger).toHaveTextContent("listView:preset.do");
      expect(trigger).toHaveAttribute("title", "zenView:presetLocked");

      fireEvent.click(trigger);
      expect(screen.getByRole("option", { name: "listView:preset.do" })).not.toHaveAttribute("aria-disabled");
      for (const preset of ["all", "plan", "start", "backlog"]) {
        const option = screen.getByRole("option", { name: `listView:preset.${preset}` });
        expect(option).toHaveAttribute("aria-disabled", "true");
        expect(option).toHaveAttribute("title", "zenView:presetLocked");
      }
      expect(useFilterStore.getState().filter.statusMode).toBe("start");
    });

    it("gives the tab its own preset back on leaving the Plan View", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
      useViewStore.setState({ view: "plan" });
      const { rerender } = render(<TopBar />);
      expect(screen.getByRole("button", { name: "listView:statusPresetLabel" })).toHaveTextContent("listView:preset.plan");

      useViewStore.setState({ view: "mindmap" });
      rerender(<TopBar />);
      const trigger = screen.getByRole("button", { name: "listView:statusPresetLabel" });
      expect(trigger).toHaveTextContent("listView:preset.do");
      expect(trigger).not.toHaveAttribute("title");
      expect(useFilterStore.getState().filter.statusMode).toBe("do");
    });

    it("draws the Plan scope beside the preset only while Plan is the preset", () => {
      const all = render(<TopBar />);
      expect(screen.queryByRole("button", { name: "filter:planScopeLabel" })).not.toBeInTheDocument();
      all.unmount();

      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
      const mindmap = render(<TopBar />);
      expect(screen.getByRole("button", { name: "filter:planScopeLabel" })).toHaveTextContent("filter:planScopeAny");
      mindmap.unmount();

      useViewStore.setState({ view: "list" });
      const list = render(<TopBar />);
      expect(screen.getByRole("button", { name: "filter:planScopeLabel" })).toBeInTheDocument();
      list.unmount();

      // Unblock replaces the preset's rules in the list, so the scope has nothing to narrow.
      useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "unblock" } });
      const unblock = render(<TopBar />);
      expect(screen.queryByRole("button", { name: "filter:planScopeLabel" })).not.toBeInTheDocument();
      unblock.unmount();
    });

    it("never draws the Plan scope in the Plan View, which has a scope of its own", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
      useViewStore.setState({ view: "plan" });
      render(<TopBar />);
      expect(screen.queryByRole("button", { name: "filter:planScopeLabel" })).not.toBeInTheDocument();
    });

    it("clears a chosen Plan scope from the top bar", () => {
      useFilterStore.setState({
        filter: { ...DEFAULT_FILTER, statusMode: "plan", planScope: { kind: "week", date: "2026-09-20" } },
      });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "filter:planScopeClear" }));
      expect(useFilterStore.getState().filter.planScope).toBeNull();
    });

    it("opens the Scope Picker from the Plan scope", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "filter:planScopeLabel" }));
      expect(screen.getByRole("group", { name: "filter:planScopePicker" })).toBeInTheDocument();
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

  describe("the Filter button's dot", () => {
    const DOT_LABEL = "filter:filterButtonUndrawnLabel";

    it("shows in the Zen View while its Agentic pill is set, which draws no chip there", () => {
      useViewStore.setState({ view: "zen" });
      useListFilterStore.getState().addPill("agentic", "agentic", "all");
      render(<TopBar />);
      expect(screen.getByRole("button", { name: DOT_LABEL })).toBeInTheDocument();
    });

    it("does not show in the List View for the same Agentic pill, which is drawn as a chip", () => {
      useViewStore.setState({ view: "list" });
      useListFilterStore.getState().addPill("agentic", "agentic", "all");
      render(<TopBar />);
      expect(screen.queryByRole("button", { name: DOT_LABEL })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "common:filter" })).toBeInTheDocument();
    });

    it("shows in the List View while Archived is off its default", () => {
      useViewStore.setState({ view: "list" });
      useFilterStore.getState().setArchivedMode("exclude");
      render(<TopBar />);
      expect(screen.getByRole("button", { name: DOT_LABEL })).toHaveAttribute("title", "filter:filterButtonTitleUndrawn");
    });

    it("does not show in the Zen View for a strip switched off", () => {
      useViewStore.setState({ view: "zen", zenCommitments: false });
      render(<TopBar />);
      expect(screen.queryByRole("button", { name: DOT_LABEL })).not.toBeInTheDocument();
    });

    it("does not show in the Plan View for Backlog, which that view does not offer", () => {
      useViewStore.setState({ view: "plan" });
      useFilterStore.getState().setBacklogMode("include");
      render(<TopBar />);
      expect(screen.queryByRole("button", { name: DOT_LABEL })).not.toBeInTheDocument();
    });
  });

  describe("Esc in the Filter menu", () => {
    /** A view's own bare-Esc binding (the Mindmap's deselect), to prove the menu keeps the key. */
    function ViewEscape({ onEscape }: { onEscape: () => void }) {
      const bindings: readonly Binding<null>[] = [
        { id: "test-escape", section: "mindmap", chord: { code: "Escape" }, labelKey: "filterCloseMenu", run: onEscape },
      ];
      useHotkeys(bindings, null, true);
      return null;
    }

    it("closes the menu, gives focus back to where it was, and never reaches the view", () => {
      const viewEscape = vi.fn();
      render(<><ViewEscape onEscape={viewEscape} /><TopBar /></>);
      const button = screen.getByRole("button", { name: "common:filter" });
      button.focus();
      fireEvent.click(button);
      const menu = screen.getByRole("dialog", { name: "common:filter" });
      expect(menu).toHaveFocus();
      fireEvent.keyDown(menu, { key: "Escape", code: "Escape" });
      expect(useFilterStore.getState().popoverOpen).toBe(false);
      expect(screen.queryByRole("dialog", { name: "common:filter" })).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      expect(viewEscape).not.toHaveBeenCalled();
    });

    it("in a search box with a query, clears the query first and closes on the second Esc", () => {
      useFilterStore.setState({ popoverOpen: true });
      render(<TopBar />);
      const box = screen.getByRole("combobox", { name: "rows.tag" });
      fireEvent.change(box, { target: { value: "urg" } });
      fireEvent.keyDown(box, { key: "Escape", code: "Escape" });
      expect(box).toHaveValue("");
      expect(useFilterStore.getState().popoverOpen).toBe(true);
      fireEvent.keyDown(box, { key: "Escape", code: "Escape" });
      expect(useFilterStore.getState().popoverOpen).toBe(false);
    });
  });
});
