import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import HotkeysModal from "./HotkeysModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // The key, standing in for the English — so a description search types a key's text.
    t: (key: string, options?: { query?: string }) => (options?.query === undefined ? key : `${key}:${options.query}`),
    i18n: { dir: () => "ltr" },
  }),
}));

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^${name}`) });
}

/** Selects a tab by clicking it and returns its panel. */
function openTab(name: string): HTMLElement {
  fireEvent.click(tab(name));
  return screen.getByRole("tabpanel");
}

function search(query: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
}

function press(code: string) {
  fireEvent.keyDown(document.activeElement ?? window, { key: code, code });
}

/** The row a label sits on: its chords and its description. */
function rowOf(scope: HTMLElement, label: string): HTMLElement | null {
  return within(scope).getByText(label).closest("div");
}

describe("HotkeysModal — tabs", () => {
  it("draws one tab per section, the Filters and Scope Picker keys included", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const names = screen.getAllByRole("tab").map((element) => element.textContent);
    expect(names).toEqual([
      "hotkeys:sectionGlobal", "hotkeys:tabFilters", "hotkeys:sectionTabs",
      "hotkeys:sectionMindmap", "hotkeys:sectionListView", "hotkeys:sectionPlanView",
      "hotkeys:tabScopePicker", "hotkeys:sectionStepsView", "hotkeys:sectionZenView",
    ]);
  });

  it("opens on the tab of the view it was opened over, marked as here", () => {
    render(<HotkeysModal onClose={vi.fn()} view="list" />);
    expect(tab("hotkeys:sectionListView")).toHaveAttribute("aria-selected", "true");
    expect(within(tab("hotkeys:sectionListView")).getByText("hotkeys:tabHere")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("hotkeys:jumpToFirstRow")).toBeInTheDocument();
    expect(within(panel).queryByText("hotkeys:zoomIn")).toBeNull();
  });

  it("with no view, opens on Global and marks no tab as here", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(tab("hotkeys:sectionGlobal")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("hotkeys:tabHere")).toBeNull();
    expect(within(screen.getByRole("tabpanel")).getByText("hotkeys:toggleHotkeys")).toBeInTheDocument();
  });

  it("when a tab is clicked, shows only that tab's rows", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const panel = openTab("hotkeys:sectionTabs");
    expect(tab("hotkeys:sectionTabs")).toHaveAttribute("aria-selected", "true");
    expect(tab("hotkeys:sectionMindmap")).toHaveAttribute("aria-selected", "false");
    expect(within(panel).getByText("hotkeys:nextTab")).toBeInTheDocument();
    expect(within(panel).queryByText("hotkeys:zoomIn")).toBeNull();
  });

  it("when → and ← are pressed with the search empty, steps through the tabs and wraps", () => {
    render(<HotkeysModal onClose={vi.fn()} view="zen" />);
    press("ArrowRight");
    expect(tab("hotkeys:sectionGlobal")).toHaveAttribute("aria-selected", "true");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(tab("hotkeys:sectionStepsView")).toHaveAttribute("aria-selected", "true");
  });

  it("leaves ← and → to the caret while a search is typed", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    search("zoom");
    press("ArrowRight");
    search("");
    expect(tab("hotkeys:sectionMindmap")).toHaveAttribute("aria-selected", "true");
  });

  it("gives only the selected tab a place in the Tab order", () => {
    render(<HotkeysModal onClose={vi.fn()} view="plan" />);
    const reachable = screen.getAllByRole("tab").filter((element) => element.tabIndex === 0);
    expect(reachable).toEqual([tab("hotkeys:sectionPlanView")]);
  });
});

describe("HotkeysModal — groups", () => {
  it("heads the Mindmap's rows with its groups", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const panel = screen.getByRole("tabpanel");
    const headings = within(panel).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "hotkeys:groupPresets", "hotkeys:groupMove", "hotkeys:groupCreate", "hotkeys:groupEdit", "hotkeys:groupDisplay",
    ]);
    const create = within(panel).getByText("hotkeys:groupCreate").closest("div");
    expect(create).not.toBeNull();
    if (create !== null) expect(within(create).getByText("hotkeys:createTaskChild")).toBeInTheDocument();
  });

  it("draws a short section flat, with no group headings", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const panel = openTab("hotkeys:sectionTabs");
    expect(within(panel).queryAllByRole("heading", { level: 4 })).toHaveLength(0);
  });
});

describe("HotkeysModal — rows", () => {
  it("renders the Ctrl+Shift+/ chord that opens it, and the Mindmap's own Ctrl+Alt+/", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // One chord each, and they are different chords: the sheet keeps Ctrl+Shift+/, the recursive
    // collapse-or-expand is on Ctrl+Alt+/.
    expect(within(screen.getByRole("tabpanel")).getAllByText("Ctrl+Shift+/")).toHaveLength(1);
    const mindmap = openTab("hotkeys:sectionMindmap");
    expect(within(mindmap).getAllByText("Ctrl+Alt+/")).toHaveLength(1);
    expect(within(mindmap).getByText("hotkeys:toggleSubtreeCollapsed")).toBeInTheDocument();
  });

  it("documents the filter modes in a Filters tab: Enter / Shift+Enter / Alt+Enter and their clicks", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const panel = openTab("hotkeys:tabFilters");
    for (const [chord, click, label] of [
      ["Enter", "hotkeys:filterClick", "hotkeys:filterAddAll"],
      ["Shift+Enter", "hotkeys:filterShiftClick", "hotkeys:filterAddAny"],
      ["Alt+Enter", "hotkeys:filterAltClick", "hotkeys:filterAddNot"],
    ] as const) {
      const row = rowOf(panel, label);
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent(chord);
      expect(row).toHaveTextContent(click);
    }
    expect(within(panel).getByText("hotkeys:filterCycle")).toBeInTheDocument();
    expect(within(panel).getByText("hotkeys:filterRemove")).toBeInTheDocument();
    for (const [label, chords] of [
      ["hotkeys:filterKindKeys", ["T", "C", "E"]],
      ["hotkeys:filterFlagKeys", ["A", "W", "B", "P"]],
      ["hotkeys:filterPrivateMode", ["Ctrl+P"]],
      ["hotkeys:filterCloseMenu", ["Esc"]],
      ["hotkeys:filterRemoveSearch", ["Delete"]],
    ] as const) {
      const row = rowOf(panel, label);
      for (const chord of chords) expect(row).toHaveTextContent(chord);
    }
  });

  it("merges every chord that triggers one action into a single row", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const mindmap = screen.getByRole("tabpanel");
    // Both zoom-in chords live on one row rather than duplicating the label.
    expect(within(mindmap).getByText("Ctrl+=")).toBeInTheDocument();
    expect(within(mindmap).getByText("Ctrl+Numpad +")).toBeInTheDocument();
    expect(within(mindmap).getAllByText("hotkeys:zoomIn")).toHaveLength(1);
  });

  it("omits hidden bindings, so the arrow row carries only the plain arrows", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const row = rowOf(screen.getByRole("tabpanel"), "hotkeys:navigate");
    expect(row).not.toBeNull();
    const chords = [...(row?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent);
    // The hidden Shift+arrow navigate fall-throughs must not leak into this row.
    expect(chords).toEqual(["←", "→", "↑", "↓"]);
  });

  const CHORDS: ReadonlyArray<[string, string]> = [
    ["Shift+D", "hotkeys:createDomainChild"],
    ["Shift+P", "hotkeys:createProjectChild"],
    ["Shift+G", "hotkeys:createGoalChild"],
    ["Shift+T", "hotkeys:createTaskChild"],
    ["Shift+I", "hotkeys:createInfoChild"],
    ["Shift+F", "hotkeys:createFlowChild"],
  ];

  // The Steps View takes the same chords, so each appears once per view.
  it.each(["hotkeys:sectionMindmap", "hotkeys:sectionStepsView"])(
    "lists all six Shift+initial chords under %s, each on its own labelled row",
    (sectionLabel) => {
      render(<HotkeysModal onClose={vi.fn()} />);
      const panel = openTab(sectionLabel);
      for (const [chord, label] of CHORDS) {
        const row = within(panel).getByText(chord).closest("div");
        expect(row).not.toBeNull();
        expect(row?.textContent).toContain(label);
      }
    },
  );

  it("lists the Scope Picker's own keys in a tab of their own", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const panel = openTab("hotkeys:tabScopePicker");
    for (const [label, chords] of [
      ["hotkeys:pickerMove", ["←", "→", "↑", "↓"]],
      ["hotkeys:pickerStepPeriod", ["[", "]"]],
      ["hotkeys:pickerUp", ["\\"]],
      ["hotkeys:pickerPick", ["Space"]],
      ["hotkeys:pickerEnter", ["Enter"]],
      ["hotkeys:pickerApply", ["Ctrl+Enter"]],
      ["hotkeys:pickerClose", ["Esc"]],
    ] as const) {
      const row = rowOf(panel, label);
      for (const chord of chords) expect(row).toHaveTextContent(chord);
    }
  });
});

describe("HotkeysModal — search", () => {
  it("focuses the search field when it opens", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("when searching a description, keeps only the rows that say it, in any case", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    search("HOTKEYS:ZOOMIN");
    expect(screen.getAllByText("hotkeys:zoomIn").length).toBeGreaterThan(0);
    expect(screen.queryByText("hotkeys:navigate")).toBeNull();
  });

  it("searches every tab at once, under section headings, with no tab selected", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    search("shift+t");
    expect(screen.queryByRole("tabpanel")).toBeNull();
    for (const element of screen.getAllByRole("tab")) expect(element).toHaveAttribute("aria-selected", "false");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    // Shift+T in the Mindmap and the Steps View; Ctrl+Shift+Tab in Tabs.
    expect(headings).toEqual(["hotkeys:sectionTabs", "hotkeys:sectionMindmap", "hotkeys:sectionStepsView"]);
    const mindmap = screen.getByRole("heading", { level: 3, name: "hotkeys:sectionMindmap" }).closest("section");
    expect(mindmap).not.toBeNull();
    if (mindmap === null) return;
    expect(within(mindmap).getByText("hotkeys:createTaskChild")).toBeInTheDocument();
    expect(within(mindmap).queryByText("hotkeys:createGoalChild")).toBeNull();
    // The group a match sits in keeps its sub-heading.
    expect(within(mindmap).getByRole("heading", { level: 4, name: "hotkeys:groupCreate" })).toBeInTheDocument();
  });

  it("hides a section left with no matching rows", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("hotkeys:pickerApply");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["hotkeys:sectionScopePicker"]);
  });

  it("when nothing matches, says so and draws no section", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("zzz-no-such-shortcut");
    expect(screen.getByText("hotkeys:searchNoMatch:zzz-no-such-shortcut")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("when the search is cleared, returns to the tab it was on", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    openTab("hotkeys:sectionZenView");
    search("zoom");
    search("");
    expect(tab("hotkeys:sectionZenView")).toHaveAttribute("aria-selected", "true");
  });

  it("when a tab is clicked during a search, clears it and shows that tab", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    search("zoom");
    openTab("hotkeys:sectionPlanView");
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(tab("hotkeys:sectionPlanView")).toHaveAttribute("aria-selected", "true");
  });
});

describe("HotkeysModal — scrolling", () => {
  /** jsdom lays nothing out, so the body's scroll offset is recorded rather than measured. */
  function trackScroll(): { body: HTMLElement; writes: number[] } {
    const body = screen.getByTestId("hotkeys-body");
    const writes: number[] = [];
    let top = 0;
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = value; writes.push(value); },
    });
    return { body, writes };
  }

  it("scrolls the body, below the fixed title, search and tabs", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const body = screen.getByTestId("hotkeys-body");
    expect(body.className).toMatch(/body/);
    expect(body).toContainElement(screen.getByRole("tabpanel"));
    expect(body).not.toContainElement(screen.getByRole("searchbox"));
    expect(body).not.toContainElement(screen.getByRole("tablist"));
  });

  it("when the tab or the query changes, puts the body back at its top", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const { body } = trackScroll();
    body.scrollTop = 300;
    openTab("hotkeys:sectionListView");
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 300;
    search("zoom");
    expect(body.scrollTop).toBe(0);
  });

  it("when PgDn and PgUp are pressed in the search field, pages the body", () => {
    render(<HotkeysModal onClose={vi.fn()} view="mindmap" />);
    const { body } = trackScroll();
    press("PageDown");
    press("PageDown");
    const paged = body.scrollTop;
    expect(paged).toBeGreaterThan(0);
    press("PageUp");
    expect(body.scrollTop).toBeLessThan(paged);
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});

describe("HotkeysModal — closing", () => {
  it("when Escape is pressed with an empty search, closes", () => {
    const onClose = vi.fn();
    render(<HotkeysModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when Escape is pressed with a search typed, clears it first and closes on the second press", () => {
    const onClose = vi.fn();
    render(<HotkeysModal onClose={onClose} view="mindmap" />);
    search("zoom");
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(tab("hotkeys:sectionMindmap")).toHaveAttribute("aria-selected", "true");
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when the backdrop is clicked, closes", () => {
    const onClose = vi.fn();
    const { container } = render(<HotkeysModal onClose={onClose} />);
    const overlay = container.firstElementChild;
    expect(overlay).not.toBeNull();
    if (overlay !== null) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
