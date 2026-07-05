import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Select from "./Select";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "plan", label: "Plan" },
  { value: "start", label: "Start" },
];

describe("Select", () => {
  it("shows the selected option's label on the trigger", () => {
    render(<Select value="plan" options={OPTIONS} onChange={vi.fn()} ariaLabel="Status" />);
    expect(screen.getByRole("button", { name: /Status/i })).toHaveTextContent("Plan");
  });

  it("opens the menu when the trigger is clicked", () => {
    render(<Select value="all" options={OPTIONS} onChange={vi.fn()} ariaLabel="Status" />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("selecting an option calls onChange and closes the menu", () => {
    const onChange = vi.fn();
    render(<Select value="all" options={OPTIONS} onChange={onChange} ariaLabel="Status" />);
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Start" }));
    expect(onChange).toHaveBeenCalledWith("start");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks the current value's option as selected", () => {
    render(<Select value="plan" options={OPTIONS} onChange={vi.fn()} ariaLabel="Status" />);
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    expect(screen.getByRole("option", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "All" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking the backdrop closes the menu without changing the value", () => {
    const onChange = vi.fn();
    const { container } = render(<Select value="all" options={OPTIONS} onChange={onChange} ariaLabel="Status" />);
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    const backdrop = container.querySelector("[class*='backdrop']");
    expect(backdrop).not.toBeNull();
    if (backdrop !== null) fireEvent.click(backdrop);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape closes the menu without changing the value", () => {
    const onChange = vi.fn();
    render(<Select value="all" options={OPTIONS} onChange={onChange} ariaLabel="Status" />);
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ArrowDown then Enter selects the next option", () => {
    const onChange = vi.fn();
    render(<Select value="all" options={OPTIONS} onChange={onChange} ariaLabel="Status" />);
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("plan");
  });
});
