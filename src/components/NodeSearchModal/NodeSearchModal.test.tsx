import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NodeSearchModal from "./NodeSearchModal";
import type { SearchableNode } from "@/utils/mindmap-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

const NODES: SearchableNode[] = [
  { id: "goal-1", title: "Ship MVP", kind: "goal", path: ["Work"] },
  { id: "task-2", title: "Write docs", kind: "task", path: ["Ship MVP", "Work"] },
  { id: "task-3", title: "Ship the newsletter", kind: "task", path: ["Marketing"] },
];

beforeEach(() => { vi.clearAllMocks(); });

describe("NodeSearchModal", () => {
  it("shows nothing (no results, no empty message) until the user types", () => {
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByText("common:noResults")).not.toBeInTheDocument();
  });

  it("filters nodes by title (case-insensitive) once typed", () => {
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "ship" } });
    expect(screen.getByText("Ship MVP")).toBeInTheDocument();
    expect(screen.getByText("Ship the newsletter")).toBeInTheDocument();
    expect(screen.queryByText("Write docs")).not.toBeInTheDocument();
  });

  it("sorts results by kind order (aspect→project→domain→flow→goal→task→info)", () => {
    const mixed: SearchableNode[] = [
      { id: "task-1", title: "match a", kind: "task", path: [] },
      { id: "goal-1", title: "match b", kind: "goal", path: [] },
      { id: "domain-1", title: "match c", kind: "domain", path: [] },
    ];
    render(<NodeSearchModal nodes={mixed} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "match" } });
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("match c"); // domain first
    expect(items[1]).toContain("match b"); // then goal
    expect(items[2]).toContain("match a"); // then task
  });

  it("disambiguates duplicate titles with the parent path in faded parentheses", () => {
    const dupes: SearchableNode[] = [
      { id: "info-1", title: "Notes", kind: "info", path: ["Ship MVP", "Work"] },
      { id: "info-2", title: "Notes", kind: "info", path: ["Launch", "Marketing"] },
    ];
    render(<NodeSearchModal nodes={dupes} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "notes" } });
    // Immediate parent alone distinguishes the two.
    expect(screen.getByText("(Ship MVP)")).toBeInTheDocument();
    expect(screen.getByText("(Launch)")).toBeInTheDocument();
  });

  it("extends the path outward when the immediate parent still collides", () => {
    const dupes: SearchableNode[] = [
      { id: "info-1", title: "Notes", kind: "info", path: ["Plan", "Work"] },
      { id: "info-2", title: "Notes", kind: "info", path: ["Plan", "Home"] },
    ];
    render(<NodeSearchModal nodes={dupes} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "notes" } });
    expect(screen.getByText("(Work › Plan)")).toBeInTheDocument();
    expect(screen.getByText("(Home › Plan)")).toBeInTheDocument();
  });

  it("selects a node on click, passing its id", () => {
    const onSelect = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "docs" } });
    fireEvent.mouseDown(screen.getByText("Write docs"));
    expect(onSelect).toHaveBeenCalledWith("task-2");
  });

  it("selects the active result on Enter, and navigates with arrows", () => {
    const onSelect = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={onSelect} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("common:searchNodesPlaceholder");
    fireEvent.change(input, { target: { value: "ship" } }); // two matches: goal then task
    fireEvent.keyDown(input, { key: "ArrowDown" }); // move to the 2nd
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("task-3");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a no-results message when a query matches nothing", () => {
    render(<NodeSearchModal nodes={NODES} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { target: { value: "zzz" } });
    expect(screen.getByText("common:noResults")).toBeInTheDocument();
  });
});
