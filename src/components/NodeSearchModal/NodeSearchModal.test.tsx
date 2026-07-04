import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NodeSearchModal from "./NodeSearchModal";
import type { SearchableNode } from "./NodeSearchModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

const NODES: SearchableNode[] = [
  { id: "goal-1", title: "Ship MVP", kind: "goal" },
  { id: "task-2", title: "Write docs", kind: "task" },
  { id: "task-3", title: "Ship the newsletter", kind: "task" },
];

beforeEach(() => { vi.clearAllMocks(); });

describe("NodeSearchModal", () => {
  it("filters nodes by title (case-insensitive)", () => {
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "ship" } });
    expect(screen.getByText("Ship MVP")).toBeInTheDocument();
    expect(screen.getByText("Ship the newsletter")).toBeInTheDocument();
    expect(screen.queryByText("Write docs")).not.toBeInTheDocument();
  });

  it("selects a node on click, passing its id", () => {
    const onSelect = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.mouseDown(screen.getByText("Write docs"));
    expect(onSelect).toHaveBeenCalledWith("task-2");
  });

  it("selects the active result on Enter, and navigates with arrows", () => {
    const onSelect = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={onSelect} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("common:searchNodesPlaceholder");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // move to the 2nd result
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("task-2");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a no-results message when nothing matches", () => {
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "zzz" } });
    expect(screen.getByText("common:noResults")).toBeInTheDocument();
  });
});
