import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import HotkeysModal from "./HotkeysModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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

  it("when Escape is pressed, closes", () => {
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
});
