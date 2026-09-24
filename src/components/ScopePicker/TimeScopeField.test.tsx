import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TimeScopeField from "./TimeScopeField";
import { getScope } from "@/api/scopes";
import type { Scope, ScopeKey } from "@/api/scopes";
import { keyStartDate } from "@/utils/scope-key";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getScope).mockImplementation((id) => Promise.resolve(scopeOf(id)));
});

describe("TimeScopeField — summary", () => {
  it("shows Unscoped when null", () => {
    render(<TimeScopeField value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unscoped")).toBeInTheDocument();
  });

  it("pluralizes the duration summary", () => {
    render(<TimeScopeField value={{ start_id: { kind: "week", date: "2026-06-07" }, end_id: { kind: "week", date: "2026-06-21" }, duration: { n: 3, kind: "week" } }} onChange={vi.fn()} />);
    expect(screen.getByText("3 weeks")).toBeInTheDocument();
  });

  it("does not pluralize a duration of 1", () => {
    render(<TimeScopeField value={{ start_id: { kind: "week", date: "2026-06-07" }, end_id: { kind: "week", date: "2026-06-07" }, duration: { n: 1, kind: "week" } }} onChange={vi.fn()} />);
    expect(screen.getByText("1 week")).toBeInTheDocument();
  });

  it("shows a single scope's formatted label", async () => {
    render(<TimeScopeField value={{ start_id: JUNE, end_id: JUNE }} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("June 2026")).toBeInTheDocument());
  });

  it("shows a range with a factored-out year", async () => {
    render(<TimeScopeField value={{ start_id: JUNE, end_id: AUGUST }} onChange={vi.fn()} />);
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
    const value: TimeScope = { start_id: JUNE, end_id: JUNE };
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
    render(<TimeScopeField value={{ start_id: { kind: "day", date: "2026-09-16" }, end_id: { kind: "day", date: "2026-09-16" } }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    // The week of Wednesday 16 September 2026, not the twelve months of the year.
    await waitFor(() => expect(screen.getByRole("button", { name: "16" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "September 2026" })).not.toBeInTheDocument();
  });
});

describe("TimeScopeField — the opening is the selection", () => {
  it("draws the cell it opens on as selected", async () => {
    render(<TimeScopeField value={{ start_id: JUNE, end_id: JUNE }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("applying without clicking re-applies the scope that was there", async () => {
    const onChange = vi.fn();
    render(<TimeScopeField value={{ start_id: JUNE, end_id: JUNE }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ start_id: JUNE, end_id: JUNE }));
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it("round-trips a range: both endpoints are selected and Apply re-applies them", async () => {
    const onChange = vi.fn();
    render(<TimeScopeField value={{ start_id: JUNE, end_id: AUGUST }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "August 2026" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ start_id: JUNE, end_id: AUGUST }));
  });

  it("a seeded range is closed, so the first click starts a new one", async () => {
    const onChange = vi.fn();
    render(<TimeScopeField value={{ start_id: JUNE, end_id: AUGUST }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "August 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "October 2026" }));
    expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "August 2026" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "October 2026" })).toHaveAttribute("aria-pressed", "true");
  });

  it("applying with nothing selected on an unscoped task changes nothing", async () => {
    const onChange = vi.fn();
    render(<TimeScopeField value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit scope" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "time scope picker" })).not.toBeInTheDocument(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
