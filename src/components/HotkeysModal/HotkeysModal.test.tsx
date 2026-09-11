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

  it("renders the Ctrl+Shift+/ chord that opens it", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByText("Ctrl+Shift+/")).toBeInTheDocument();
  });

  it("does not render bindings marked hidden", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // The numpad zoom alias is hidden; the primary Ctrl+= row is not.
    expect(screen.queryByText("Ctrl+Numpad +")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+=")).toBeInTheDocument();
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
