import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TimeScopeField from "./TimeScopeField";
import { getOrCreateScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/api/scopes", () => ({
  getOrCreateScope: vi.fn(),
  getOrCreatePartScope: vi.fn(),
  getOrCreateExactScope: vi.fn(),
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
});

describe("TimeScopeField — summary", () => {
  it("shows Unscoped when null", () => {
    render(<TimeScopeField value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Unscoped")).toBeInTheDocument();
  });

  it("shows the duration summary when set as a duration", () => {
    const value: TimeScope = { start_id: 1, end_id: 2, duration: { n: 3, kind: "week" } };
    render(<TimeScopeField value={value} onChange={vi.fn()} />);
    expect(screen.getByText("3 week")).toBeInTheDocument();
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
