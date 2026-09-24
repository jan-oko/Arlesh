import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlanField from "./PlanField";
import { getScope, resolveScope } from "@/api/scopes";
import type { Scope, ScopeKey } from "@/api/scopes";
import { keyStartDate } from "@/utils/scope-key";
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
  getScope: vi.fn(),
  resolveScope: vi.fn(),
}));

const JUNE: ScopeKey = { kind: "month", date: "2026-06-01" };
const AUGUST: ScopeKey = { kind: "month", date: "2026-08-01" };

/** The scope a key names, as the backend derives it — kind and start date are in the key. */
function scopeOf(id: ScopeKey): Scope {
  return {
    id, kind: id.kind, label: "",
    start_date: keyStartDate(id), end_date: keyStartDate(id),
    part: null, start_datetime: null, end_datetime: null,
  };
}

const single = (id: ScopeKey): TimeScope => ({ start_id: id, end_id: id });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getScope).mockImplementation((id) => Promise.resolve(scopeOf(id)));
});

describe("PlanField", () => {
  it("shows Unplanned when null and the scope label when set", async () => {
    const { rerender } = render(<PlanField value={null} timeScope={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unplanned")).toBeInTheDocument();
    rerender(<PlanField value={single(JUNE)} timeScope={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("June 2026")).toBeInTheDocument());
  });

  it("clear emits null", () => {
    const onChange = vi.fn();
    render(<PlanField value={single(JUNE)} timeScope={null} onChange={onChange} />);
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
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        start_id: { kind: "day", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      })),
    );
  });

  it("resolves the Time Scope window to constrain the picker when opened", async () => {
    vi.mocked(resolveScope).mockResolvedValue({
      start: "2026-06-01T02:00:00",
      end: "2026-07-01T02:00:00",
      active: false,
    });
    render(<PlanField value={null} timeScope={single(JUNE)} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    await waitFor(() => expect(resolveScope).toHaveBeenCalledWith(JUNE));
  });
});

describe("PlanField — the opening is the selection", () => {
  it("draws the cell it opens on as selected and re-applies it untouched", async () => {
    const onChange = vi.fn();
    render(<PlanField value={single(JUNE)} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ start_id: JUNE, end_id: JUNE }));
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it("round-trips a two-endpoint plan", async () => {
    const onChange = vi.fn();
    render(<PlanField value={{ start_id: JUNE, end_id: AUGUST }} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "August 2026" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ start_id: JUNE, end_id: AUGUST }));
  });

  it("applying with nothing selected on an unplanned task changes nothing", async () => {
    const onChange = vi.fn();
    render(<PlanField value={null} timeScope={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit plan" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "plan picker" })).not.toBeInTheDocument(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
