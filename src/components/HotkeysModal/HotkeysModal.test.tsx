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

describe("HotkeysModal", () => {
  it("renders a section heading for every surface", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByText("hotkeys:sectionGlobal")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionMindmap")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionListView")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionPlanView")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionStepsView")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionZenView")).toBeInTheDocument();
  });

  it("renders the Ctrl+Shift+/ chord that opens it, and the Mindmap's own Ctrl+Alt+/", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // One chord each, and they are different chords: the sheet keeps Ctrl+Shift+/, the recursive
    // collapse-or-expand is on Ctrl+Alt+/.
    expect(screen.getAllByText("Ctrl+Shift+/")).toHaveLength(1);
    expect(screen.getAllByText("Ctrl+Alt+/")).toHaveLength(1);
    expect(screen.getByText("hotkeys:toggleHotkeys")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:toggleSubtreeCollapsed")).toBeInTheDocument();
  });

  it("documents the filter modes in a Filters section: Enter / Shift+Enter / Alt+Enter and their clicks", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const section = screen.getByText("hotkeys:sectionFilters").closest("section");
    expect(section).not.toBeNull();
    if (section === null) return;
    const list = within(section);
    for (const [chord, click, label] of [
      ["Enter", "hotkeys:filterClick", "hotkeys:filterAddAll"],
      ["Shift+Enter", "hotkeys:filterShiftClick", "hotkeys:filterAddAny"],
      ["Alt+Enter", "hotkeys:filterAltClick", "hotkeys:filterAddNot"],
    ] as const) {
      const row = list.getByText(label).closest("div");
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent(chord);
      expect(row).toHaveTextContent(click);
    }
    expect(list.getByText("hotkeys:filterCycle")).toBeInTheDocument();
    expect(list.getByText("hotkeys:filterRemove")).toBeInTheDocument();
    for (const [label, chords] of [
      ["hotkeys:filterKindKeys", ["T", "C", "E"]],
      ["hotkeys:filterFlagKeys", ["A", "W", "B", "P"]],
      ["hotkeys:filterPrivateMode", ["Ctrl+P"]],
      ["hotkeys:filterRemoveSearch", ["Delete"]],
    ] as const) {
      const row = list.getByText(label).closest("div");
      for (const chord of chords) expect(row).toHaveTextContent(chord);
    }
  });

  it("merges every chord that triggers one action into a single row", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // Scoped to the Mindmap's own section: the Steps View binds Ctrl+= to its card size, so the
    // chord is no longer unique on the sheet — what this pins is that one *action* is one row.
    const heading = screen.getByText("hotkeys:sectionMindmap").closest("section");
    expect(heading).not.toBeNull();
    if (heading === null) return;
    const mindmap = within(heading);
    // Both zoom-in chords live on one row rather than duplicating the label.
    expect(mindmap.getByText("Ctrl+=")).toBeInTheDocument();
    expect(mindmap.getByText("Ctrl+Numpad +")).toBeInTheDocument();
    expect(mindmap.getAllByText("hotkeys:zoomIn")).toHaveLength(1);
  });

  it("omits hidden bindings, so the arrow row carries only the plain arrows", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const label = screen.getByText("hotkeys:navigate");
    const row = label.closest("div");
    expect(row).not.toBeNull();
    const chords = [...(row?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent);
    // The hidden Shift+arrow navigate fall-throughs must not leak into this row.
    expect(chords).toEqual(["←", "→", "↑", "↓"]);
  });

  it("when Escape is pressed with an empty search, closes", () => {
    const onClose = vi.fn();
    render(<HotkeysModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
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

describe("HotkeysModal — typed-child chords", () => {
  const CHORDS: ReadonlyArray<[string, string]> = [
    ["Shift+D", "hotkeys:createDomainChild"],
    ["Shift+P", "hotkeys:createProjectChild"],
    ["Shift+G", "hotkeys:createGoalChild"],
    ["Shift+T", "hotkeys:createTaskChild"],
    ["Shift+I", "hotkeys:createInfoChild"],
    ["Shift+F", "hotkeys:createFlowChild"],
  ];

  // Scoped per section: the Steps View takes the same chords, so each appears once per view.
  it.each(["hotkeys:sectionMindmap", "hotkeys:sectionStepsView"])(
    "lists all six Shift+initial chords under %s, each on its own labelled row",
    (sectionLabel) => {
      render(<HotkeysModal onClose={vi.fn()} />);
      const section = screen.getByText(sectionLabel).closest("section");
      expect(section).not.toBeNull();
      if (section === null) return;
      for (const [chord, label] of CHORDS) {
        const kbd = within(section).getByText(chord);
        const row = kbd.closest("div");
        expect(row).not.toBeNull();
        expect(row?.textContent).toContain(label);
      }
    },
  );

  it("lists the Scope Picker's own keys in a section of their own", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    const section = screen.getByText("hotkeys:sectionScopePicker").closest("section");
    expect(section).not.toBeNull();
    if (section === null) return;
    const list = within(section);
    for (const [label, chords] of [
      ["hotkeys:pickerMove", ["←", "→", "↑", "↓"]],
      ["hotkeys:pickerStepPeriod", ["[", "]"]],
      ["hotkeys:pickerUp", ["\\"]],
      ["hotkeys:pickerPick", ["Space"]],
      ["hotkeys:pickerEnter", ["Enter"]],
      ["hotkeys:pickerApply", ["Ctrl+Enter"]],
      ["hotkeys:pickerClose", ["Esc"]],
    ] as const) {
      const row = list.getByText(label).closest("div");
      for (const chord of chords) expect(row).toHaveTextContent(chord);
    }
  });
});

describe("HotkeysModal — search", () => {
  function search(query: string) {
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
  }

  it("focuses the search field when it opens", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("when searching a description, keeps only the rows that say it, in any case", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("HOTKEYS:ZOOMIN");
    expect(screen.getAllByText("hotkeys:zoomIn").length).toBeGreaterThan(0);
    expect(screen.queryByText("hotkeys:navigate")).toBeNull();
    expect(screen.queryByText("hotkeys:toggleHotkeys")).toBeNull();
  });

  it("when searching a key label such as shift+t, keeps the rows bound to it", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("shift+t");
    const mindmap = screen.getByText("hotkeys:sectionMindmap").closest("section");
    expect(mindmap).not.toBeNull();
    if (mindmap === null) return;
    expect(within(mindmap).getByText("hotkeys:createTaskChild")).toBeInTheDocument();
    expect(within(mindmap).queryByText("hotkeys:createGoalChild")).toBeNull();
  });

  it("hides a section left with no matching rows", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("hotkeys:pickerApply");
    expect(screen.getByText("hotkeys:sectionScopePicker")).toBeInTheDocument();
    expect(screen.queryByText("hotkeys:sectionGlobal")).toBeNull();
    expect(screen.queryByText("hotkeys:sectionFilters")).toBeNull();
    expect(screen.queryByText("hotkeys:sectionMindmap")).toBeNull();
  });

  it("when nothing matches, says so and draws no section", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    search("zzz-no-such-shortcut");
    expect(screen.getByText("hotkeys:searchNoMatch:zzz-no-such-shortcut")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("when Escape is pressed with a search typed, clears it first and closes on the second press", () => {
    const onClose = vi.fn();
    render(<HotkeysModal onClose={onClose} />);
    search("zoom");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape", code: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("hotkeys:sectionGlobal")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
