import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterChips from "./FilterChips";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-filter-display");

const mockUseFilterDisplay = vi.mocked(useFilterDisplay);

const DISPLAY = {
  tagOptions: [],
  tagName: (id: number) => (id === 5 ? "urgent" : `#${id}`),
  tagColor: (id: number) => (id === 5 ? "#3498db" : null),
  nodeLabel: (ref: string) => (ref === "project-1" ? "Rocket" : ref),
  nodeColor: (ref: string) => (ref === "project-1" ? "#e74c3c" : null),
  antecedentPool: [],
  dependencyPool: [],
  displayTaskStatus: (v: string) => `task.${v}`,
  displayGoalStatus: (v: string) => `goal.${v}`,
  displayProjectStatus: (v: string) => `project.${v}`,
  displayVerdict: (v: string) => `verdict.${v}`,
  displayScopeState: (v: string) => `scope.${v}`,
  displayBlocked: (v: string) => `blocked.${v}`,
  displayAgentic: (v: string) => `agentic.${v}`,
  displayAsynchronous: (v: string) => `asynchronous.${v}`,
};

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useViewStore.setState({ view: "mindmap" });
  mockUseFilterDisplay.mockReturnValue(DISPLAY);
});

describe("FilterChips", () => {
  it("renders nothing when no filter is active", () => {
    const { container } = render(<FilterChips />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip for an active tag filter with its resolved name", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 5, mode: "any" }] } });
    render(<FilterChips />);
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("clicking the chip body cycles All → Any → Not → All", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 5, mode: "all" }] } });
    render(<FilterChips />);
    const modes: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByText("urgent"));
      modes.push(useFilterStore.getState().filter.tagFilters[0]?.mode ?? "");
    }
    expect(modes).toEqual(["any", "exclude", "all"]);
  });

  it("a yes/no chip reads Not while excluding, and flips rather than cycling through Any", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, blocked: [{ value: "blocked", mode: "all" }] } },
    });
    render(<FilterChips />);
    expect(screen.getByText("blocked.blocked")).toBeInTheDocument();
    fireEvent.click(screen.getByText("blocked.blocked"));
    expect(useListFilterStore.getState().filter.pills.blocked).toEqual([{ value: "blocked", mode: "exclude" }]);
    expect(screen.getByText("blocked.not_blocked")).toBeInTheDocument();
    fireEvent.click(screen.getByText("blocked.not_blocked"));
    expect(useListFilterStore.getState().filter.pills.blocked).toEqual([{ value: "blocked", mode: "all" }]);
  });

  it("reads a Private chip as Private or Not private", () => {
    useViewStore.setState({ view: "list" });
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, private: [{ value: "private", mode: "exclude" }] } },
    });
    render(<FilterChips />);
    expect(screen.getByText("privateState.not_private")).toBeInTheDocument();
  });

  it("names the dimension in the chip's accessible name, with Under for the old Antecedent", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, antecedent: [{ value: "project-1", mode: "all" }] } },
    });
    render(<FilterChips />);
    expect(screen.getByRole("button", { name: "chipAria" })).toBeInTheDocument();
  });

  it("Delete on a focused chip removes it", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 5, mode: "all" }] } });
    render(<FilterChips />);
    fireEvent.keyDown(screen.getByRole("button", { name: "chipAria" }), { key: "Delete" });
    expect(useFilterStore.getState().filter.tagFilters).toEqual([]);
  });

  it("clicking the embedded × removes the chip without cycling its mode", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 5, mode: "any" }] } });
    render(<FilterChips />);
    fireEvent.click(screen.getByRole("button", { name: "removeTagFilter" }));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([]);
  });

  it("does not render List-View-exclusive pill chips while the Mindmap is active", () => {
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, blocked: [{ value: "blocked", mode: "any" }] } },
    });
    useViewStore.setState({ view: "mindmap" });
    const { container } = render(<FilterChips />);
    expect(container.firstChild).toBeNull();
  });

  it("renders pill-filter chips while List View is active, with resolved labels", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: {
        ...DEFAULT_LIST_FILTER,
        pills: {
          ...DEFAULT_LIST_FILTER.pills,
          antecedent: [{ value: "project-1", mode: "any" }],
          blocked: [{ value: "blocked", mode: "exclude" }],
        },
      },
    });
    render(<FilterChips />);
    expect(screen.getByText("Rocket")).toBeInTheDocument();
    expect(screen.getByText("blocked.not_blocked")).toBeInTheDocument();
  });

  it("removing a pill-filter chip calls removePill for the right dimension/value", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, taskStatus: [{ value: "todo", mode: "any" }] } },
    });
    render(<FilterChips />);
    fireEvent.click(screen.getByRole("button", { name: "removeTagFilter" }));
    expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([]);
  });
});
