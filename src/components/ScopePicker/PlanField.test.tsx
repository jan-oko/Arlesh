import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlanField from "./PlanField";
import { getOrCreateScope, resolveScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";

vi.mock("@/api/scopes", () => ({
  getOrCreateScope: vi.fn(),
  getOrCreatePartScope: vi.fn(),
  getOrCreateExactScope: vi.fn(),
  resolveScope: vi.fn(),
}));

function mkScope(id: number): Scope {
  return {
    id, kind: "day", label: "", start_date: "", end_date: "",
    week_id: null, month_id: null, season_id: null, day_id: null,
    part: null, start_datetime: null, end_datetime: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateScope).mockResolvedValue(mkScope(42));
});

describe("PlanField", () => {
  it("shows Unplanned when null and Planned when set", () => {
    const { rerender } = render(<PlanField value={null} timeScope={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unplanned")).toBeInTheDocument();
    rerender(<PlanField value={7} timeScope={null} onChange={vi.fn()} />);
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("clear emits null", () => {
    const onChange = vi.fn();
    render(<PlanField value={7} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selecting a day and applying emits the scope id", async () => {
    const onChange = vi.fn();
    render(<PlanField value={null} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    // Day view renders numbered day cells; click the first.
    const dayCells = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent ?? ""));
    fireEvent.click(dayCells[0]!);
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(42));
  });

  it("resolves the Time Scope window to constrain the picker when opened", async () => {
    vi.mocked(resolveScope).mockResolvedValue({
      start: "2026-06-01T00:00:00",
      end: "2026-07-01T00:00:00",
      active: false,
    });
    const timeScope: TimeScope = { start_id: 5, end_id: 5 };
    render(<PlanField value={null} timeScope={timeScope} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    await waitFor(() => expect(resolveScope).toHaveBeenCalledWith(5));
  });
});
