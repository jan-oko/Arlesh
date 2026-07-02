import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlanField from "./PlanField";
import { getOrCreateScope, getScope, resolveScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/hooks/use-scope-labels", () => ({
  useScopeLabels: () => ({
    unscoped: "Unscoped",
    unplanned: "Unplanned",
    week: (n: number) => `W${n}`,
    month: (m: number) => ["Jan", "Feb", "Mar", "Apr", "May", "June"][m - 1] ?? "M",
    season: (name: string) => name,
    duration: (count: number, kind: string) => `${count} ${kind}`,
  }),
}));

vi.mock("@/api/scopes", () => ({
  getOrCreateScope: vi.fn(),
  getOrCreatePartScope: vi.fn(),
  getOrCreateExactScope: vi.fn(),
  getScope: vi.fn(),
  resolveScope: vi.fn(),
}));

function mkScope(id: number, overrides: Partial<Scope> = {}): Scope {
  return {
    id, kind: "day", label: "", start_date: "2026-06-20", end_date: "2026-06-20",
    week_id: null, month_id: null, season_id: null, day_id: null,
    part: null, start_datetime: null, end_datetime: null,
    ...overrides,
  };
}

const single = (id: number): TimeScope => ({ start_id: id, end_id: id });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateScope).mockResolvedValue(mkScope(42));
  vi.mocked(getScope).mockImplementation((id) =>
    Promise.resolve(mkScope(id, { kind: "month", start_date: "2026-06-01" })),
  );
});

describe("PlanField", () => {
  it("shows Unplanned when null and the scope label when set", async () => {
    const { rerender } = render(<PlanField value={null} timeScope={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unplanned")).toBeInTheDocument();
    rerender(<PlanField value={single(7)} timeScope={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("June 2026")).toBeInTheDocument());
  });

  it("clear emits null", () => {
    const onChange = vi.fn();
    render(<PlanField value={single(7)} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "scopeClear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selecting a day and applying emits a Time Scope", async () => {
    const onChange = vi.fn();
    render(<PlanField value={null} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    const dayCells = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent ?? ""));
    fireEvent.click(dayCells[0]!);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ start_id: 42, end_id: 42 })),
    );
  });

  it("resolves the Time Scope window to constrain the picker when opened", async () => {
    vi.mocked(resolveScope).mockResolvedValue({
      start: "2026-06-01T00:00:00",
      end: "2026-07-01T00:00:00",
      active: false,
    });
    render(<PlanField value={null} timeScope={single(5)} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    await waitFor(() => expect(resolveScope).toHaveBeenCalledWith(5));
  });
});
