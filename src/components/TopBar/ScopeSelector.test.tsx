import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ScopeSelector from "./ScopeSelector";
import { useFilterStore } from "@/stores/use-filter-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { getScope, getOrCreateScope } from "@/api/scopes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/scopes");

const mockGetScope = vi.mocked(getScope);
const mockGetOrCreateScope = vi.mocked(getOrCreateScope);

/** W35 2026, as the backend stores one: inclusive dates, the window derived from them on read. */
const WEEK_35 = {
  id: 7,
  kind: "week",
  label: "W35",
  start_date: "2026-08-24",
  end_date: "2026-08-30",
  week_id: null,
  month_id: null,
  season_id: null,
  day_id: null,
  part: null,
  start_datetime: null,
  end_datetime: null,
} as const;

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  mockGetScope.mockResolvedValue({ ...WEEK_35 });
  mockGetOrCreateScope.mockResolvedValue({ ...WEEK_35 });
});

describe("ScopeSelector", () => {
  it("reads 'Any scope' with nothing selected, and offers nothing to clear", () => {
    render(<ScopeSelector />);
    expect(screen.getByRole("button", { name: "scopeLabel" })).toHaveTextContent("anyScope");
    expect(screen.queryByRole("button", { name: "clearScope" })).not.toBeInTheDocument();
  });

  it("names the selected scope in the bar and clears it from there", async () => {
    useFilterStore.setState({
      filter: { ...DEFAULT_FILTER, scope: { startId: 7, endId: 7, axis: "relevance", match: "overlapping" } },
    });
    render(<ScopeSelector />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "scopeLabel" })).toHaveTextContent("W35");
    });
    fireEvent.click(screen.getByRole("button", { name: "clearScope" }));
    expect(useFilterStore.getState().filter.scope).toBeNull();
  });

  it("applies the picked scope with the axis and match rule chosen beside it", async () => {
    render(<ScopeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "scopeLabel" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeAxisPlan" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeMatchWithin" }));
    // The picker opens on the month view, whose cells are the weeks of that month — which is what
    // a scope filter is usually pointed at.
    const weeks = screen.getAllByRole("button", { name: /^Week \d+$/ });
    fireEvent.click(weeks[0] ?? fail("the month view draws its weeks"));
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => {
      expect(useFilterStore.getState().filter.scope).toEqual({
        startId: 7,
        endId: 7,
        axis: "plan",
        match: "within",
      });
    });
  });

  it("changes the rule of a live selection in place, without re-picking the scope", async () => {
    useFilterStore.setState({
      filter: { ...DEFAULT_FILTER, scope: { startId: 7, endId: 7, axis: "relevance", match: "overlapping" } },
    });
    render(<ScopeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "scopeLabel" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeMatchWithin" }));
    await waitFor(() => {
      expect(useFilterStore.getState().filter.scope).toEqual({
        startId: 7,
        endId: 7,
        axis: "relevance",
        match: "within",
      });
    });
  });
});

function fail(message: string): never {
  throw new Error(message);
}
