import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HotkeysModal from "./HotkeysModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

describe("HotkeysModal", () => {
  it("renders a section heading for each of the three sections", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByText("hotkeys:sectionGlobal")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionMindmap")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionListView")).toBeInTheDocument();
  });

  it("renders the Ctrl+Alt+/ chord that opens it, and the Mindmap's own Ctrl+Shift+/", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // One chord each, and they are different chords: the sheet is on Ctrl+Alt+/, the recursive
    // collapse-or-expand keeps Ctrl+Shift+/.
    expect(screen.getAllByText("Ctrl+Alt+/")).toHaveLength(1);
    expect(screen.getAllByText("Ctrl+Shift+/")).toHaveLength(1);
    expect(screen.getByText("hotkeys:toggleHotkeys")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:toggleSubtreeCollapsed")).toBeInTheDocument();
  });

  it("merges every chord that triggers one action into a single row", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // Both zoom-in chords live on one row rather than duplicating the label.
    expect(screen.getByText("Ctrl+=")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Numpad +")).toBeInTheDocument();
    expect(screen.getAllByText("hotkeys:zoomIn")).toHaveLength(1);
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

  it("lists all six Shift+initial chords, each on its own labelled row", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    for (const [chord, label] of CHORDS) {
      const kbd = screen.getByText(chord);
      const row = kbd.closest("div");
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain(label);
    }
  });
});
