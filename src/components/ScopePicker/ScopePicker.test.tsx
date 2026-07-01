import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScopePicker from "./ScopePicker";
import type { UseScopePicker } from "@/hooks/use-scope-picker";
import type { ScopeRef } from "@/utils/scope-ref";

function stubPicker(overrides: Partial<UseScopePicker> = {}): UseScopePicker {
  return {
    mode: "single",
    single: null,
    range: { start: null, end: null },
    handleClick: vi.fn(),
    adjustEndpoint: vi.fn(),
    reset: vi.fn(),
    resolve: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const TODAY = "2026-06-15";

describe("ScopePicker — rendering & selection", () => {
  it("renders the twelve months at the month view", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" today={TODAY} />);
    expect(screen.getByRole("button", { name: "January 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "December 2026" })).toBeInTheDocument();
  });

  it("clicking a cell applies the click with the cell's scope ref", () => {
    const picker = stubPicker();
    render(<ScopePicker picker={picker} initialKind="month" today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "June 2026" }));
    const expected: ScopeRef = { kind: "month", date: "2026-06-01" };
    expect(picker.handleClick).toHaveBeenCalledWith(expected);
  });

  it("marks the cell containing today with aria-current", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" today={TODAY} />);
    expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-current", "date");
    expect(screen.getByRole("button", { name: "May 2026" })).not.toHaveAttribute("aria-current");
  });

  it("marks the selected cell as pressed", () => {
    const picker = stubPicker({ single: { kind: "month", date: "2026-06-01" } });
    render(<ScopePicker picker={picker} initialKind="month" today={TODAY} />);
    expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "May 2026" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ScopePicker — navigation", () => {
  it("double-clicking a month descends into its weeks", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" today={TODAY} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "June 2026" }));
    // Week view of June: several "Week N" cells appear.
    expect(screen.getAllByText(/^Week \d+$/).length).toBeGreaterThan(0);
  });

  it("browses to the next year", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByRole("button", { name: "June 2027" })).toBeInTheDocument();
  });

  it("ascends from month to season", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    expect(screen.getByRole("button", { name: "Summer 2026" })).toBeInTheDocument();
  });

  it("disables the up button at the coarsest (season) view", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="season" today={TODAY} />);
    expect(screen.getByRole("button", { name: "up" })).toBeDisabled();
  });
});
