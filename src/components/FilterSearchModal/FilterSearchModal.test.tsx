import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, within } from "@testing-library/react";
import FilterSearchModal from "./FilterSearchModal";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useMindmapStore } from "@/stores/use-mindmap-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/hooks/use-filter-display");
vi.mock("@/hooks/use-close-to-tray", () => ({ useQuit: () => vi.fn() }));

const mockUseFilterDisplay = vi.mocked(useFilterDisplay);

const DISPLAY = {
  tagOptions: [{ id: 1, label: "urgent", color: "#e74c3c" }, { id: 2, label: "home", color: null }],
  tagName: (id: number) => (id === 1 ? "urgent" : "home"), tagColor: () => null,
  nodeLabel: (ref: string) => ref, nodeColor: () => null,
  antecedentPool: [
    { id: "aspect-1", label: "ARLESH", color: null, path: "" },
    { id: "domain-2", label: "Connections", color: null, path: "Growth › BOND" },
    { id: "project-1", label: "Rocket", color: null, path: "" },
  ],
  dependencyPool: [
    { id: "task-9", label: "Fuel up", color: null, path: "" },
    { id: "task-10", label: "Connections review", color: null, path: "Growth" },
  ],
  displayTaskStatus: (v: string) => v, displayGoalStatus: (v: string) => `goal ${v}`,
  displayProjectStatus: (v: string) => `project ${v}`, displayVerdict: (v: string) => v,
  displayScopeState: (v: string) => v, displayBlocked: (v: string) => v,
  displayAgentic: (v: string) => v,
  displayAsynchronous: (v: string) => v,
};

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER }, searchOpen: false, popoverOpen: false });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useViewStore.setState({ view: "list" });
  mockUseFilterDisplay.mockReturnValue(DISPLAY);
});

const box = () => screen.getByRole("combobox", { name: "search.dialogLabel" });
const option = (name: string) => screen.getByRole("option", { name });
const optionLabels = () => screen.getAllByRole("option").map((o) => o.querySelector("[class*=title]")?.textContent);
const switchOption = (label: string, state: string) => {
  const found = screen.getByRole("option", { name: new RegExp(`^${label}`) });
  expect(within(found).getByText(state)).toBeInTheDocument();
  return found;
};
const headings = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));

describe("FilterSearchModal", () => {
  it("opens with the search focused", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    expect(box()).toHaveFocus();
  });

  it("shows only the search box and the hint until something is typed", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("search.hintKeys.any")).toBeInTheDocument();
  });

  it("finds nodes by name in the List View, as Under and Depends on results, with their path", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "connections" } });
    expect(headings()).toEqual(["groups.antecedent", "groups.dependency"]);
    const under = screen.getByRole("group", { name: "groups.antecedent" });
    expect(within(under).getByText("search.nodePrefix")).toBeInTheDocument();
    expect(within(under).getByText("(Growth › BOND)")).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "ARLESH" } });
    expect(optionLabels()).toEqual(["ARLESH"]);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(useListFilterStore.getState().filter.pills.antecedent).toEqual([{ value: "aspect-1", mode: "all" }]);
  });

  it("adds Depends on from a node result", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "connections" } });
    fireEvent.click(within(screen.getByRole("group", { name: "groups.dependency" })).getByRole("option"), { shiftKey: true });
    expect(useListFilterStore.getState().filter.pills.dependency).toEqual([{ value: "task-10", mode: "any" }]);
  });

  it("outside the List View, says node filters are List View only instead of showing nothing", () => {
    useViewStore.setState({ view: "mindmap" });
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "ARLESH" } });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("search.nodesListOnly")).toBeInTheDocument();
    expect(screen.queryByText("search.noResults")).not.toBeInTheDocument();
  });

  it("offers only Tags and the switches outside the List View", () => {
    useViewStore.setState({ view: "mindmap" });
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "e" } });
    expect(headings()).toEqual(["groups.tag", "groups.switches"]);
  });

  it("says when nothing matches", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "zzz" } });
    expect(screen.getByText("search.noResults")).toBeInTheDocument();
  });

  it("narrows by value and by a dimension's name, old names included", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "rock" } });
    expect(optionLabels()).toEqual(["Rocket"]);
    fireEvent.change(box(), { target: { value: "dependency" } });
    expect(optionLabels()).toContain("Fuel up");
  });

  it.each([
    { keys: {}, mode: "all" },
    { keys: { shiftKey: true }, mode: "any" },
    { keys: { altKey: true }, mode: "exclude" },
  ])("Enter with $keys adds the highlighted value as $mode, clears the query and stays open", ({ keys, mode }) => {
    const onClose = vi.fn();
    render(<FilterSearchModal onClose={onClose} />);
    fireEvent.change(box(), { target: { value: "urg" } });
    fireEvent.keyDown(box(), { key: "Enter", ...keys });
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 1, mode }]);
    expect(box()).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "urgent" })).not.toBeInTheDocument();
  });

  it("adds with a click, reading its modifiers", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "done" } });
    fireEvent.click(option("done"), { altKey: true });
    expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([{ value: "done", mode: "exclude" }]);
  });

  it("walks the results with the arrows", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "o" } });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("offers each yes/no dimension once, found by its Not wording too, and adds Not with Alt", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "not_blocked" } });
    expect(optionLabels()).toEqual(["blocked"]);
    fireEvent.keyDown(box(), { key: "Enter", altKey: true });
    expect(useListFilterStore.getState().filter.pills.blocked).toEqual([{ value: "blocked", mode: "exclude" }]);
  });

  it("lists a yes/no pill added with Shift as plain All", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "agentic" } });
    fireEvent.click(option("agentic"), { shiftKey: true });
    expect(useListFilterStore.getState().filter.pills.agentic).toEqual([{ value: "agentic", mode: "all" }]);
  });

  describe("switches", () => {
    it("includes Archived on Enter, excludes it on Alt+Enter, and clears it when picked in its own state", () => {
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "archivedPill" } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(useFilterStore.getState().filter.archivedMode).toBe("include");
      fireEvent.change(box(), { target: { value: "archivedPill" } });
      switchOption("archivedPill", "search.switchState.include");
      fireEvent.keyDown(box(), { key: "Enter", altKey: true });
      expect(useFilterStore.getState().filter.archivedMode).toBe("exclude");
      fireEvent.change(box(), { target: { value: "archivedPill" } });
      fireEvent.click(switchOption("archivedPill", "search.switchState.exclude"), { altKey: true });
      expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
    });

    it("treats Shift on a switch as a plain pick", () => {
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "backlog" } });
      fireEvent.click(switchOption("backlogPill", "search.switchState.inactive"), { shiftKey: true });
      expect(useFilterStore.getState().filter.backlogMode).toBe("include");
    });

    it("offers no Private Mode result: Private is the menu's switch", () => {
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "private" } });
      expect(screen.queryByRole("option", { name: /privateMode/ })).not.toBeInTheDocument();
    });

    it("offers the Private flag while Private Mode is on: Enter only private, Alt not private", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "not_private" } });
      expect(optionLabels()).toEqual(["privateState.private"]);
      fireEvent.keyDown(box(), { key: "Enter", altKey: true });
      expect(useListFilterStore.getState().filter.pills.private).toEqual([{ value: "private", mode: "exclude" }]);
    });

    it("does not offer the Private flag while Private Mode is off", () => {
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "privateState" } });
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    it("does not offer the Private flag outside the List View", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
      useViewStore.setState({ view: "mindmap" });
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "privateState" } });
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    it("shows the row kinds with their state, and toggles one on Enter", () => {
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "rowKind.commitment" } });
      switchOption("listView:rowKind.commitment", "search.rowKindState.shown");
      fireEvent.keyDown(box(), { key: "Enter", altKey: true });
      expect(useListFilterStore.getState().filter.kinds).toEqual(["task", "expectation"]);
      fireEvent.change(box(), { target: { value: "rowKind.commitment" } });
      switchOption("listView:rowKind.commitment", "search.rowKindState.hidden");
    });

    it("refuses to hide the last kind, with a toast saying why", () => {
      useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, kinds: ["task"] } });
      useMindmapStore.setState({ pendingToast: null });
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "rowKind.task" } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(useListFilterStore.getState().filter.kinds).toEqual(["task"]);
      expect(useMindmapStore.getState().pendingToast?.message).toBe("listView:rowKindRefused.lastKind");
    });

    it("offers no row kinds outside the List View", () => {
      useViewStore.setState({ view: "mindmap" });
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "rowKind" } });
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    it("offers no Backlog in the Plan View, which answers it itself", () => {
      useViewStore.setState({ view: "plan" });
      render(<FilterSearchModal onClose={vi.fn()} />);
      fireEvent.change(box(), { target: { value: "pill" } });
      expect(screen.queryByRole("option", { name: /backlogPill/ })).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: /archivedPill/ })).toBeInTheDocument();
    });
  });

  it("closes on Esc", () => {
    const onClose = vi.fn();
    render(<FilterSearchModal onClose={onClose} />);
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the modifier hint", () => {
    render(<FilterSearchModal onClose={vi.fn()} />);
    expect(screen.getByText("search.hintKeys.any")).toBeInTheDocument();
    expect(screen.getByText("search.hintKeys.not")).toBeInTheDocument();
  });
});

describe("Ctrl+F", () => {
  it("opens the filter search, closing the Filter menu", () => {
    useFilterStore.setState({ popoverOpen: true });
    renderHook(() => useGlobalHotkeys());
    fireEvent.keyDown(window, { code: "KeyF", key: "f", ctrlKey: true });
    expect(useFilterStore.getState().searchOpen).toBe(true);
    expect(useFilterStore.getState().popoverOpen).toBe(false);
  });
});
