import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FlowCycleField from "./FlowCycleField";
import type { FlowCyclePair } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

const onChange = vi.fn();
beforeEach(() => { vi.clearAllMocks(); });

describe("FlowCycleField — unscoped flow", () => {
  it("shows the whole-scope fallback, no picker", () => {
    render(<FlowCycleField flowScopeN={null} flowScopeKind={null} value={[]} onChange={onChange} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("editor:cycleWholeScope")).toBeInTheDocument();
  });
});

describe("FlowCycleField — day-scoped flow (single-level picker)", () => {
  const base = { flowScopeN: 1, flowScopeKind: "day", value: [] as FlowCyclePair[], onChange };

  it("shows the picker directly when there are no cycles yet, labelled with real band names", () => {
    render(<FlowCycleField {...base} />);
    expect(screen.getByRole("button", { name: "scopes:part.morning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scopes:part.premorning" })).toBeInTheDocument();
    // Already in picker mode: the single toggle shows as the confirm (checkmark) state.
    expect(screen.getByRole("button", { name: "editor:cycleDone" })).toBeInTheDocument();
  });

  it("toggles a cycle on immediately when a band is clicked — no separate Add step", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "scopes:part.morning" }));
    expect(onChange).toHaveBeenCalledWith([
      { scopeKind: "part_of_day", scopeIndex: 1, planKind: null, planStart: null, planEnd: null },
    ]);
  });

  it("toggles an existing cycle back off when its band is clicked again in edit mode", () => {
    const pair: FlowCyclePair = { scopeKind: "part_of_day", scopeIndex: 1, planKind: null, planStart: null, planEnd: null };
    render(<FlowCycleField {...base} value={[pair]} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleEdit" }));
    const morning = screen.getByRole("button", { name: "scopes:part.morning" });
    expect(morning).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(morning);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("offers no Plan section for a Part of Day target — it has no finer kind to plan within", () => {
    render(<FlowCycleField {...base} />);
    expect(screen.queryByText("editor:cyclePlanKind")).not.toBeInTheDocument();
  });
});

describe("FlowCycleField — existing cycles render as a list by default", () => {
  const pair: FlowCyclePair = { scopeKind: "part_of_day", scopeIndex: 4, planKind: null, planStart: null, planEnd: null };
  const base = { flowScopeN: 1, flowScopeKind: "day", value: [pair], onChange };

  it("shows a row per cycle instead of the picker", () => {
    render(<FlowCycleField {...base} />);
    expect(screen.getByText("scopes:part.evening")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "scopes:part.morning" })).not.toBeInTheDocument();
  });

  it("opens the picker via the single edit/confirm toggle", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleEdit" }));
    expect(screen.getByRole("button", { name: "scopes:part.morning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor:cycleDone" })).toBeInTheDocument();
  });

  it("returns to the chip list when the confirm toggle is clicked", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleEdit" }));
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleDone" }));
    expect(screen.getByText("scopes:part.evening")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "scopes:part.morning" })).not.toBeInTheDocument();
  });

  it("removes a chip directly, without opening the picker", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("adds a whole-scope cycle from within the picker", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleEdit" }));
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleAddWhole" }));
    expect(onChange).toHaveBeenCalledWith([
      pair,
      { scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null },
    ]);
  });
});

describe("FlowCycleField — multi-period drill-down (2-week flow)", () => {
  const base = { flowScopeN: 2, flowScopeKind: "week", value: [] as FlowCyclePair[], onChange };

  it("descends one level (Week) before reaching the Day toggle grid, computing the flat index across the whole window", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:kindWeek 2" }));
    fireEvent.click(screen.getByRole("button", { name: "editor:kindDay 3" }));
    // Week 2, Day 3 = day 10 of the flow window (7 + 3).
    expect(onChange).toHaveBeenCalledWith([
      { scopeKind: "day", scopeIndex: 10, planKind: null, planStart: null, planEnd: null },
    ]);
  });

  it("navigates three levels deep for a Part of Day target, and Up steps back one level", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.change(screen.getByDisplayValue("editor:kindDay"), { target: { value: "part_of_day" } });
    fireEvent.click(screen.getByRole("button", { name: "editor:kindWeek 2" }));
    fireEvent.click(screen.getByRole("button", { name: "editor:kindDay 1" }));
    expect(screen.getByRole("button", { name: "scopes:part.noon" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    expect(screen.getByRole("button", { name: "editor:kindDay 1" })).toBeInTheDocument();
  });
});

describe("FlowCycleField — a pair's Planned toggle", () => {
  const MORNING: FlowCyclePair = { scopeKind: "part_of_day", scopeIndex: 1, planKind: null, planStart: null, planEnd: null };
  const PLANNED_MORNING: FlowCyclePair = { ...MORNING, planKind: "part_of_day", planStart: 1, planEnd: 1 };

  it("plans a Morning pair into its own Morning", () => {
    render(<FlowCycleField flowScopeN={1} flowScopeKind="day" value={[MORNING]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cyclePlanned" }));
    expect(onChange).toHaveBeenCalledWith([PLANNED_MORNING]);
  });

  it("plans a pair of any kind into its own scope — Day 10 into Day 10", () => {
    const day: FlowCyclePair = { scopeKind: "day", scopeIndex: 10, planKind: null, planStart: null, planEnd: null };
    render(<FlowCycleField flowScopeN={2} flowScopeKind="week" value={[day]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cyclePlanned" }));
    expect(onChange).toHaveBeenCalledWith([{ ...day, planKind: "day", planStart: 1, planEnd: 1 }]);
  });

  it("shows a planned pair on its chip, and turning it off clears the plan", () => {
    render(<FlowCycleField flowScopeN={1} flowScopeKind="day" value={[PLANNED_MORNING]} onChange={onChange} />);
    expect(screen.getByText("scopes:part.morning · editor:cyclePlannedToScope")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "editor:cyclePlanned" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith([MORNING]);
  });

  it("shows an older, finer plan read-only, and the toggle clears it", () => {
    const finer: FlowCyclePair = { scopeKind: "day", scopeIndex: 3, planKind: "part_of_day", planStart: 2, planEnd: 2 };
    render(<FlowCycleField flowScopeN={1} flowScopeKind="week" value={[finer]} onChange={onChange} />);
    expect(screen.getByText("editor:kindDay 3 · editor:kindPart 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "editor:cyclePlanned" }));
    expect(onChange).toHaveBeenCalledWith([{ ...finer, planKind: null, planStart: null, planEnd: null }]);
  });

  it("offers no plan inside the picker, which only chooses Cycle Scopes", () => {
    render(<FlowCycleField flowScopeN={2} flowScopeKind="week" value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:kindWeek 1" }));
    expect(screen.queryByText("editor:cyclePlanKind")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor:cycleAddWhole" })).toBeInTheDocument();
  });
});
