import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TimeScopeField from "./TimeScopeField";
import { getOrCreateScope, getScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/hooks/use-scope-labels", () => ({
  useScopeLabels: () => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return {
      unscoped: "Unscoped",
      unplanned: "Unplanned",
      week: (n: number) => `W${n}`,
      month: (m: number) => months[m - 1] ?? "",
      season: (name: string) => name,
      duration: (count: number, kind: string) => `${count} ${kind}${count === 1 ? "" : "s"}`,
    };
  },
}));

vi.mock("@/api/scopes", () => ({
  getOrCreateScope: vi.fn(),
  getOrCreatePartScope: vi.fn(),
  getOrCreateExactScope: vi.fn(),
  getScope: vi.fn(),
  resolveScope: vi.fn(),
}));

function mkScope(id: number): Scope {
  return {
    id, kind: "week", label: "", start_date: "", end_date: "",
    week_id: null, month_id: null, season_id: null, day_id: null,
    part: null, start_datetime: null, end_datetime: null,
  };
}

let counter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  vi.mocked(getOrCreateScope).mockImplementation(() => Promise.resolve(mkScope(++counter)));
  const dates: Record<number, string> = { 1: "2026-06-01", 2: "2026-08-01", 5: "2026-06-01" };
  vi.mocked(getScope).mockImplementation((id) =>
    Promise.resolve({ ...mkScope(id), kind: "month", start_date: dates[id] ?? "2026-06-01" }),
  );
});

describe("TimeScopeField — summary", () => {
  it("shows Unscoped when null", () => {
    render(<TimeScopeField value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unscoped")).toBeInTheDocument();
  });

  it("pluralizes the duration summary", () => {
    render(<TimeScopeField value={{ start_id: 1, end_id: 2, duration: { n: 3, kind: "week" } }} onChange={vi.fn()} />);
    expect(screen.getByText("3 weeks")).toBeInTheDocument();
  });

  it("does not pluralize a duration of 1", () => {
    render(<TimeScopeField value={{ start_id: 1, end_id: 1, duration: { n: 1, kind: "week" } }} onChange={vi.fn()} />);
    expect(screen.getByText("1 week")).toBeInTheDocument();
  });

  it("shows a single scope's formatted label", async () => {
    render(<TimeScopeField value={{ start_id: 5, end_id: 5 }} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("June 2026")).toBeInTheDocument());
  });

  it("shows a range with a factored-out year", async () => {
    render(<TimeScopeField value={{ start_id: 1, end_id: 2 }} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("June-August 2026")).toBeInTheDocument());
  });
});

describe("TimeScopeField — editing", () => {
  it("opens the picker on 'edit scope'", () => {
    render(<TimeScopeField value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    expect(screen.getByRole("group", { name: "time scope picker" })).toBeInTheDocument();
  });

  it("clear emits null", () => {
    const onChange = vi.fn();
    const value: TimeScope = { start_id: 1, end_id: 1 };
    render(<TimeScopeField value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "scopeClear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("duration form snapshots and persists the duration params", async () => {
    const onChange = vi.fn();
    render(<TimeScopeField value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeDuration" }));
    // Pick an anchor week, then apply.
    fireEvent.click(screen.getAllByText(/^Week \d+$/)[0]!);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ duration: { n: 1, kind: "week" } }),
      ),
    );
  });
});

describe("TimeScopeField — opening view", () => {
  it("opens the picker on Month when there is no scope", () => {
    render(<TimeScopeField value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    expect(screen.getByRole("button", { name: "January 2026" })).toBeInTheDocument();
  });

  it("opens the picker on the day of a Day-scoped value", async () => {
    vi.mocked(getScope).mockImplementation((id) =>
      Promise.resolve({ ...mkScope(id), kind: "day", start_date: "2026-09-16" }),
    );
    render(<TimeScopeField value={{ start_id: 9, end_id: 9 }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    // The week of Wednesday 16 September 2026, not the twelve months of the year.
    await waitFor(() => expect(screen.getByRole("button", { name: "16" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "September 2026" })).not.toBeInTheDocument();
  });
});
