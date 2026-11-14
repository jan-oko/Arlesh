import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HelpView from "./HelpView";
import { GRAPH_NODES } from "@/data/derivation-graph";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number; name?: string }) => (options === undefined ? key : `${key}:${options.count ?? options.name}`) }),
}));

function box(label: string): HTMLElement {
  const found = screen.getAllByRole("button").find((element) => element.getAttribute("aria-label")?.startsWith(`${label}. `));
  if (found === undefined) throw new Error(`no box ${label}`);
  return found;
}

describe("HelpView", () => {
  it("draws every box of the graph", () => {
    render(<HelpView onClose={vi.fn()} />);
    const boxes = screen.getAllByRole("button").filter((element) => element.hasAttribute("aria-pressed"));
    expect(boxes).toHaveLength(GRAPH_NODES.length);
  });

  it("shows the whole map: a jump list, every group and every concept card", () => {
    render(<HelpView onClose={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "groups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node kinds" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trustworthy history and a truthful board" })).toBeInTheDocument();
  });

  it("has no title bar: the close button is the only chrome, and the map's own heading leads", () => {
    render(<HelpView onClose={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "close" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "title" })).not.toBeInTheDocument();
  });

  it("jumps to a group from the jump list", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<HelpView onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "3Time" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("previews a box on hover and focus", () => {
    render(<HelpView onClose={vi.fn()} />);
    fireEvent.mouseEnter(box("Time Scope"));
    expect(screen.getAllByText("Time Scope").length).toBeGreaterThan(1);
    expect(screen.queryByText("hintTitle")).not.toBeInTheDocument();
    fireEvent.mouseLeave(box("Time Scope"));
    expect(screen.getByText("hintTitle")).toBeInTheDocument();
  });

  it("pins a card on click and on Enter, and clears them", () => {
    render(<HelpView onClose={vi.fn()} />);
    fireEvent.click(box("Time Scope"));
    expect(box("Time Scope")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "selectedCount:1" })).toBeInTheDocument();

    fireEvent.keyDown(box("Plan"), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "selectedCount:2" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByRole("heading", { name: "selectedCount:0" })).toBeInTheDocument();
    expect(box("Time Scope")).toHaveAttribute("aria-pressed", "false");
  });

  it("closes from the close button and on Escape", () => {
    const onClose = vi.fn();
    render(<HelpView onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
