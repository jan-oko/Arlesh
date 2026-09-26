import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import FilterPopover from "./FilterPopover";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
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
  useViewStore.setState({ view: "mindmap" });
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

/** The button a pill's text sits in — a set pill's accessible name is its mode sentence. */
function pill(text: string): HTMLElement {
  const button = screen.getByText(text).closest("button");
  if (button === null) throw new Error(`no pill reads ${text}`);
  return button;
}

/** The labels of the dimension rows below the switch block, top to bottom. */
function rowLabels(): string[] {
  return screen.getAllByRole("group")
    .map((group) => group.getAttribute("aria-label") ?? "")
    .filter((label) => label.startsWith("rows."));
}

describe("FilterPopover — switch block", () => {
  it("shows the include-flows subtoggle only in Plan/Start", () => {
    render(<FilterPopover />);
    expect(screen.queryByText("includeFlows")).not.toBeInTheDocument(); // All
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
    const { unmount } = render(<FilterPopover />);
    expect(screen.getAllByText("includeFlows").length).toBeGreaterThan(0);
    unmount();
  });

  it("no longer carries the Plan scope, which lives in the top bar", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "plan" } });
    render(<FilterPopover />);
    expect(screen.queryByRole("button", { name: "filter:planScopeLabel" })).not.toBeInTheDocument();
  });

  it("toggles Info visibility off via the type pill (Mindmap only)", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:info" }));
    expect(useFilterStore.getState().filter.showInfo).toBe(false);
  });

  it("does not show the node types while List View is active", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    expect(screen.queryByRole("button", { name: "nodeKinds:info" })).not.toBeInTheDocument();
  });

  it("toggles Private Mode", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByLabelText("privateMode"));
    expect(useFilterStore.getState().filter.privateMode).toBe(true);
  });

  it("has no Advanced disclosure: Archived and Backlog are in the switch block", () => {
    render(<FilterPopover />);
    expect(screen.queryByRole("button", { name: "advanced" })).not.toBeInTheDocument();
    const switches = screen.getByRole("group", { name: "switchesLabel" });
    expect(within(switches).getByRole("button", { name: "archivedPill" })).toBeInTheDocument();
    expect(within(switches).getByRole("button", { name: "backlogPill" })).toBeInTheDocument();
  });

  it.each(["mindmap", "list", "steps"] as const)("offers Archived and Backlog in the %s view", (view) => {
    useViewStore.setState({ view });
    render(<FilterPopover />);
    expect(screen.getByRole("button", { name: "archivedPill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "backlogPill" })).toBeInTheDocument();
  });

  it("leaves Backlog out of the Plan View, which answers it with a switch of its own", () => {
    useViewStore.setState({ view: "plan" });
    render(<FilterPopover />);
    expect(screen.getByRole("button", { name: "archivedPill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "backlogPill" })).not.toBeInTheDocument();
  });

  it.each([
    { name: "archivedPill", read: () => useFilterStore.getState().filter.archivedMode },
    { name: "backlogPill", read: () => useFilterStore.getState().filter.backlogMode },
  ])("cycles $name off → include → exclude → off in the List View", ({ name, read }) => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    const modes: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name }));
      modes.push(read());
    }
    expect(modes).toEqual(["include", "exclude", "inactive"]);
  });

  it("reset clears the shared filter (and the list filter, while List View is active)", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true, archivedMode: "exclude" } });
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({
      filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills, blocked: [{ value: "blocked", mode: "all" }] } },
    });
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(useFilterStore.getState().filter.privateMode).toBe(false);
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
    expect(useListFilterStore.getState().filter.pills.blocked).toEqual([]);
  });
});

describe("FilterPopover — rows", () => {
  it("lays out the List View's rows in their groups", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    expect(rowLabels()).toEqual([
      "rows.antecedent", "rows.tag", "rows.dependency",
      "rows.scopeState", "rows.yesNo",
      "rows.taskStatus", "rows.goalStatus", "rows.projectStatus", "rows.verdict",
    ]);
  });

  it.each(["mindmap", "steps", "plan"] as const)("gives the %s view the Tags row alone", (view) => {
    useViewStore.setState({ view });
    render(<FilterPopover />);
    expect(rowLabels()).toEqual(["rows.tag"]);
  });

  describe("fixed values", () => {
    beforeEach(() => {
      useViewStore.setState({ view: "list" });
    });

    it.each([
      { keys: {}, mode: "all" },
      { keys: { shiftKey: true }, mode: "any" },
      { keys: { altKey: true }, mode: "exclude" },
    ])("a click with $keys adds the value as $mode", ({ keys, mode }) => {
      render(<FilterPopover />);
      fireEvent.click(pill("todo"), keys);
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([{ value: "todo", mode }]);
    });

    it("Enter adds as All, Shift+Enter as Any, Alt+Enter as Not", () => {
      render(<FilterPopover />);
      fireEvent.keyDown(pill("todo"), { key: "Enter" });
      fireEvent.keyDown(pill("done"), { key: "Enter", shiftKey: true });
      fireEvent.keyDown(pill("in_progress"), { key: "Enter", altKey: true });
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([
        { value: "todo", mode: "all" }, { value: "done", mode: "any" }, { value: "in_progress", mode: "exclude" },
      ]);
    });

    it("keeps an added value in its row, wearing its mode, and cycles it All → Any → Not → All on click", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("kept"));
      expect(pill("kept")).toHaveAttribute("data-set-pill");
      expect(pill("kept")).toHaveTextContent("∩");
      const modes: string[] = [];
      for (let step = 0; step < 3; step += 1) {
        fireEvent.click(pill("kept"));
        modes.push(useListFilterStore.getState().filter.pills.verdict[0]?.mode ?? "");
      }
      expect(modes).toEqual(["any", "exclude", "all"]);
    });

    it("strikes a Not value through", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("lapsed"), { altKey: true });
      expect(pill("lapsed")).toHaveTextContent("∅");
      expect(screen.getByText("lapsed").className).toMatch(/struck/);
    });

    it("Delete removes a set value and leaves focus on the pill, now plain", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("todo"));
      pill("todo").focus();
      fireEvent.keyDown(pill("todo"), { key: "Delete" });
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([]);
      expect(pill("todo")).not.toHaveAttribute("data-set-pill");
      expect(pill("todo")).toHaveFocus();
    });

    it("Backspace removes a set value too", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("todo"));
      fireEvent.keyDown(pill("todo"), { key: "Backspace" });
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([]);
    });
  });

  describe("yes/no pills", () => {
    beforeEach(() => {
      useViewStore.setState({ view: "list" });
    });

    it("collapses each yes/no dimension to one pill in the Yes / no row", () => {
      render(<FilterPopover />);
      const row = screen.getByRole("group", { name: "rows.yesNo" });
      expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["blocked", "agentic", "asynchronous"]);
      expect(screen.queryByText("not_blocked")).not.toBeInTheDocument();
    });

    it("adds 'is X' on a click (Shift too) and 'is not X' with Alt", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("blocked"));
      fireEvent.click(pill("agentic"), { shiftKey: true });
      fireEvent.click(pill("asynchronous"), { altKey: true });
      const pills = useListFilterStore.getState().filter.pills;
      expect(pills.blocked).toEqual([{ value: "blocked", mode: "all" }]);
      expect(pills.agentic).toEqual([{ value: "agentic", mode: "all" }]);
      expect(pills.asynchronous).toEqual([{ value: "asynchronous", mode: "exclude" }]);
    });

    it("flips an added yes/no pill rather than cycling through Any", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("blocked"));
      fireEvent.click(pill("blocked"));
      expect(useListFilterStore.getState().filter.pills.blocked).toEqual([{ value: "blocked", mode: "exclude" }]);
      fireEvent.click(pill("blocked"));
      expect(useListFilterStore.getState().filter.pills.blocked).toEqual([{ value: "blocked", mode: "all" }]);
    });

    it("adds a Private pill to the Yes / no row only while Private Mode is on", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
      render(<FilterPopover />);
      const row = screen.getByRole("group", { name: "rows.yesNo" });
      expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(
        ["blocked", "agentic", "asynchronous", "privateState.private"],
      );
      fireEvent.click(pill("privateState.private"), { altKey: true });
      expect(useListFilterStore.getState().filter.pills.private).toEqual([{ value: "private", mode: "exclude" }]);
    });

    it("turning Private Mode off removes the Private pill and says so in a toast", () => {
      useFilterStore.setState({ filter: { ...DEFAULT_FILTER, privateMode: true } });
      useListFilterStore.getState().addPill("private", "private", "all");
      useMindmapStore.setState({ pendingToast: null });
      render(<FilterPopover />);
      fireEvent.click(screen.getByLabelText("privateMode"));
      expect(useFilterStore.getState().filter.privateMode).toBe(false);
      expect(useListFilterStore.getState().filter.pills.private).toEqual([]);
      expect(useMindmapStore.getState().pendingToast?.message).toBe("privateFilterRemoved");
      expect(screen.queryByText("privateState.private")).not.toBeInTheDocument();
    });

    it("leaves the Blocked dimension alone when an Agentic pill is added", () => {
      render(<FilterPopover />);
      fireEvent.click(pill("agentic"), { altKey: true });
      expect(useListFilterStore.getState().filter.pills.blocked).toEqual([]);
    });
  });

  describe("inline searches", () => {
    it("adds a tag from its row's search box, as All on Enter", () => {
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        tagOptions: [{ id: 1, label: "urgent", color: "#e74c3c" }, { id: 2, label: "home", color: null }],
      });
      render(<FilterPopover />);
      const box = screen.getByRole("combobox", { name: "rows.tag" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "urg" } });
      expect(screen.getByRole("option", { name: "urgent" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "home" })).not.toBeInTheDocument();
      fireEvent.keyDown(box, { key: "Enter" });
      expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 1, mode: "all" }]);
      expect(box).toHaveValue("");
    });

    it("lists nothing until you type", () => {
      mockUseFilterDisplay.mockReturnValue({ ...EMPTY_DISPLAY, tagOptions: [{ id: 1, label: "urgent", color: null }] });
      render(<FilterPopover />);
      fireEvent.focus(screen.getByRole("combobox", { name: "rows.tag" }));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("moves with the arrows and adds with Shift+Enter as Any", () => {
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        tagOptions: [{ id: 1, label: "home", color: null }, { id: 2, label: "homework", color: null }],
      });
      render(<FilterPopover />);
      const box = screen.getByRole("combobox", { name: "rows.tag" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "home" } });
      fireEvent.keyDown(box, { key: "ArrowDown" });
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
      expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 2, mode: "any" }]);
    });

    it("adds with Alt+click as Not, and shows the added value beside the box, gone from the dropdown", () => {
      useViewStore.setState({ view: "list" });
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        nodeLabel: (ref: string) => (ref === "project-1" ? "Rocket" : ref),
        antecedentPool: [{ id: "project-1", label: "Rocket", color: "#e74c3c", path: "" }, { id: "project-2", label: "Rover", color: null, path: "" }],
      });
      render(<FilterPopover />);
      const box = screen.getByRole("combobox", { name: "rows.antecedent" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "ro" } });
      fireEvent.click(screen.getByRole("option", { name: "Rocket" }), { altKey: true });
      expect(useListFilterStore.getState().filter.pills.antecedent).toEqual([{ value: "project-1", mode: "exclude" }]);
      const row = screen.getByRole("group", { name: "rows.antecedent" });
      expect(within(row).getByText("Rocket").closest("button")).toHaveAttribute("data-set-pill");
      fireEvent.change(box, { target: { value: "ro" } });
      expect(screen.queryByRole("option", { name: "Rocket" })).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Rover" })).toBeInTheDocument();
    });

    it("searches Depends on in its own pool", () => {
      useViewStore.setState({ view: "list" });
      mockUseFilterDisplay.mockReturnValue({ ...EMPTY_DISPLAY, dependencyPool: [{ id: "task-9", label: "Fuel up", color: null, path: "" }] });
      render(<FilterPopover />);
      const box = screen.getByRole("combobox", { name: "rows.dependency" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "fuel" } });
      fireEvent.click(screen.getByRole("option", { name: "Fuel up" }));
      expect(useListFilterStore.getState().filter.pills.dependency).toEqual([{ value: "task-9", mode: "all" }]);
    });

    it("cycles a set pill in the row and, on Delete, moves focus to the next one or the box", () => {
      useFilterStore.setState({
        filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 1, mode: "all" }, { tagId: 2, mode: "all" }] },
      });
      mockUseFilterDisplay.mockReturnValue({
        ...EMPTY_DISPLAY,
        tagName: (id: number) => (id === 1 ? "urgent" : "home"),
        tagOptions: [{ id: 1, label: "urgent", color: null }, { id: 2, label: "home", color: null }],
      });
      render(<FilterPopover />);
      fireEvent.click(pill("urgent"));
      expect(useFilterStore.getState().filter.tagFilters[0]).toEqual({ tagId: 1, mode: "any" });
      fireEvent.keyDown(pill("urgent"), { key: "Delete" });
      expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 2, mode: "all" }]);
      expect(pill("home")).toHaveFocus();
      fireEvent.keyDown(pill("home"), { key: "Backspace" });
      expect(screen.getByRole("combobox", { name: "rows.tag" })).toHaveFocus();
    });

    it("Esc clears the query without letting the key reach the menu", () => {
      mockUseFilterDisplay.mockReturnValue({ ...EMPTY_DISPLAY, tagOptions: [{ id: 1, label: "urgent", color: null }] });
      const outer = vi.fn();
      render(<div onKeyDown={outer}><FilterPopover /></div>);
      const box = screen.getByRole("combobox", { name: "rows.tag" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "urg" } });
      fireEvent.keyDown(box, { key: "Escape" });
      expect(box).toHaveValue("");
      expect(outer).not.toHaveBeenCalled();
    });
  });
});

describe("FilterPopover row-kind selector", () => {
  const kindButton = (kind: string) => screen.getByRole("button", { name: `rowKind.${kind}` });

  it("opens the popover in List View, above every other filter", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    const selector = screen.getByRole("group", { name: "rowKindsLabel" });
    const firstGroup = screen.getAllByRole("group")[0];
    expect(firstGroup).toBe(selector);
    expect(selector).toContainElement(kindButton("task"));
    expect(kindButton("commitment")).toHaveAttribute("aria-pressed", "true");
    expect(kindButton("expectation")).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["mindmap", "plan", "steps"] as const)("is not drawn in the %s view", (view) => {
    useViewStore.setState({ view });
    render(<FilterPopover />);
    expect(screen.queryByRole("group", { name: "rowKindsLabel" })).not.toBeInTheDocument();
  });

  it("toggles each kind off and back on", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    for (const kind of ["task", "commitment", "expectation"] as const) {
      fireEvent.click(kindButton(kind));
      expect(useListFilterStore.getState().filter.kinds).not.toContain(kind);
      expect(kindButton(kind)).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(kindButton(kind));
      expect(useListFilterStore.getState().filter.kinds).toContain(kind);
    }
  });

  it("will not turn the last kind off", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, kinds: ["commitment"] } });
    render(<FilterPopover />);
    expect(kindButton("commitment")).toBeDisabled();
    expect(kindButton("commitment")).toHaveAttribute("title", "rowKindRefused.lastKind");
    fireEvent.click(kindButton("commitment"));
    expect(useListFilterStore.getState().filter.kinds).toEqual(["commitment"]);
    expect(kindButton("task")).toBeEnabled();
  });

  it("stands aside under the Expectations option, which is a kind choice of its own", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "expectations" } });
    render(<FilterPopover />);
    for (const kind of ["task", "commitment", "expectation"] as const) {
      expect(kindButton(kind)).toBeDisabled();
      expect(kindButton(kind)).toHaveAttribute("title", "rowKindRefused.expectationsOption");
    }
  });

  it("names its shortcut in each toggle's tooltip", () => {
    useViewStore.setState({ view: "list" });
    render(<FilterPopover />);
    expect(kindButton("task")).toHaveAttribute("title", "rowKindTooltip");
  });

  it("Reset shows every kind again", () => {
    useViewStore.setState({ view: "list" });
    useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, kinds: ["task"] } });
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(useListFilterStore.getState().filter.kinds).toEqual(["task", "commitment", "expectation"]);
  });
});
