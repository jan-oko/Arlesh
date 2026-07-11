import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FilterPopover from "./FilterPopover";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
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
  useViewStore.setState({ view: "mindmap" });
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

describe("FilterPopover", () => {
  it("shows the include-flows subtoggle only in Plan/Start", () => {
    render(<FilterPopover />);
    expect(screen.queryByText("includeFlows")).not.toBeInTheDocument(); // All
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
    const { unmount } = render(<FilterPopover />);
    expect(screen.getAllByText("includeFlows").length).toBeGreaterThan(0);
    unmount();
  });

  it("toggles Info visibility off via the type pill (Mindmap only)", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:info" }));
    expect(useFilterStore.getState().filter.showInfo).toBe(false);
  });

  it("does not show the node-type section while List View is active", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    expect(screen.queryByText("typesLabel")).not.toBeInTheDocument();
  });

  it("adds a tag filter (default Any) from the search combobox", async () => {
    mockUseFilterDisplay.mockReturnValue({
      ...EMPTY_DISPLAY,
      tagOptions: [{ id: 1, label: "urgent", color: null }],
    });
    render(<FilterPopover />);
    fireEvent.focus(await screen.findByPlaceholderText("addTag"));
    await waitFor(() => expect(screen.getByText("urgent")).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText("urgent"));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 1, mode: "any" }]);
  });

  it("an already-selected tag no longer appears as a candidate", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 1, mode: "any" }] } });
    mockUseFilterDisplay.mockReturnValue({
      ...EMPTY_DISPLAY,
      tagOptions: [{ id: 1, label: "urgent", color: null }],
    });
    render(<FilterPopover />);
    expect(screen.queryByPlaceholderText("addTag")).not.toBeInTheDocument();
  });

  it("toggles Work mode", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByText("workMode").closest("label") ?? screen.getByText("workMode"));
    expect(useFilterStore.getState().filter.workMode).toBe(true);
  });

  it("hides the archived pill behind a collapsed Advanced disclosure by default", () => {
    render(<FilterPopover />);
    expect(screen.queryByRole("button", { name: "archivedPill" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
    expect(screen.getByRole("button", { name: "archivedPill" })).toBeInTheDocument();
  });

  it("auto-opens the Advanced disclosure when the archived filter is already active", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, archivedMode: "exclude" } });
    render(<FilterPopover />);
    expect(screen.getByRole("button", { name: "archivedPill" })).toBeInTheDocument();
  });

  it("cycles the archived pill Inactive → Include → Exclude → Inactive on click (Mindmap only)", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
    const pill = screen.getByRole("button", { name: "archivedPill" });
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
    fireEvent.click(pill);
    expect(useFilterStore.getState().filter.archivedMode).toBe("include");
    fireEvent.click(pill);
    expect(useFilterStore.getState().filter.archivedMode).toBe("exclude");
    fireEvent.click(pill);
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
  });

  it("does not show the Advanced disclosure while List View is active", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    expect(screen.queryByRole("button", { name: "advanced" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "archivedPill" })).not.toBeInTheDocument();
  });

  it("reset clears the shared filter (and the list filter, while List View is active)", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, workMode: true } });
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, blocked: [{ value: "blocked", mode: "any" }] } },
    });
    render(<FilterPopover />);
    fireEvent.click(screen.getByText("reset"));
    expect(useFilterStore.getState().filter.workMode).toBe(false);
    expect(useListFilterStore.getState().filter.pills.blocked).toEqual([]);
  });

  describe("List View filter sections", () => {
    beforeEach(() => {
      useViewStore.setState({ view: "list" });
    });

    it("does not render List-View-exclusive sections while the Mindmap is active", () => {
      useViewStore.setState({ view: "mindmap" });
      render(<FilterPopover />);
      expect(screen.queryByText("listView:taskStatusLabel")).not.toBeInTheDocument();
    });

    it("renders the Hierarchy and Status & Scope clusters while List View is active", () => {
      render(<FilterPopover />);
      expect(screen.getByText("listView:hierarchyClusterLabel")).toBeInTheDocument();
      expect(screen.getByText("listView:statusScopeClusterLabel")).toBeInTheDocument();
    });

    it("adds a fixed-option pill (task status) by clicking it", () => {
      render(<FilterPopover />);
      fireEvent.click(screen.getByText("todo"));
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([{ value: "todo", mode: "any" }]);
    });

    it("an already-added fixed value no longer appears as a candidate", () => {
      useListFilterStore.getState().addPill("blocked", "blocked");
      render(<FilterPopover />);
      expect(screen.queryByText("blocked")).not.toBeInTheDocument();
      expect(screen.getByText("not_blocked")).toBeInTheDocument();
    });

    it("adds a parent filter pill from the searchable combobox", async () => {
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        parentPool: [{ id: "project-1", label: "Rocket", color: "#e74c3c" }],
      });
      render(<FilterPopover />);
      fireEvent.focus(await screen.findByPlaceholderText("listView:addParent"));
      await waitFor(() => expect(screen.getByText("Rocket")).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByText("Rocket"));
      expect(useListFilterStore.getState().filter.pills.parent).toEqual([{ value: "project-1", mode: "any" }]);
    });

    it("an already-added parent no longer appears as a candidate", () => {
      useListFilterStore.getState().addPill("parent", "project-1");
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        parentPool: [{ id: "project-1", label: "Rocket", color: null }],
      });
      render(<FilterPopover />);
      expect(screen.queryByPlaceholderText("listView:addParent")).not.toBeInTheDocument();
    });

    it("adds a dependency filter pill from its own pool (tasks/goals only)", async () => {
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        dependencyPool: [{ id: "task-9", label: "Fuel up", color: null }],
      });
      render(<FilterPopover />);
      fireEvent.focus(await screen.findByPlaceholderText("listView:addDependency"));
      await waitFor(() => expect(screen.getByText("Fuel up")).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByText("Fuel up"));
      expect(useListFilterStore.getState().filter.pills.dependency).toEqual([{ value: "task-9", mode: "any" }]);
    });
  });
});
