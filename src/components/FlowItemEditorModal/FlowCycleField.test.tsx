import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FlowCycleField from "./FlowCycleField";
import type { FlowCyclePair } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

const onChange = vi.fn();
beforeEach(() => { vi.clearAllMocks(); });

// flowScope = 2 weeks → the default cycle-scope subkind is "day" (14 cells labeled "kindDay N").
const base = { flowScopeN: 2, flowScopeKind: "week", value: [] as FlowCyclePair[], onChange };

describe("FlowCycleField", () => {
  it("renders one scope cell per nominal subdivision of the flow window", () => {
    render(<FlowCycleField {...base} />);
    expect(screen.getByRole("button", { name: "kindDay 14" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "kindDay 15" })).not.toBeInTheDocument();
  });

  it("adds one pair per selected scope cell", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "kindDay 3" }));
    fireEvent.click(screen.getByRole("button", { name: "kindDay 5" }));
    fireEvent.click(screen.getByRole("button", { name: "cycleAdd" }));
    expect(onChange).toHaveBeenCalledWith([
      { scopeKind: "day", scopeIndex: 3, planKind: null, planStart: null, planEnd: null },
      { scopeKind: "day", scopeIndex: 5, planKind: null, planStart: null, planEnd: null },
    ]);
  });

  it("attaches a chosen plan range to added pairs", () => {
    render(<FlowCycleField {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "kindDay 1" }));
    // Choose a part-of-day plan, then select a single plan slot.
    fireEvent.change(screen.getByDisplayValue("cyclePlanNone"), { target: { value: "part_of_day" } });
    fireEvent.click(screen.getByRole("button", { name: "kindPart 2" }));
    fireEvent.click(screen.getByRole("button", { name: "cycleAdd" }));
    expect(onChange).toHaveBeenCalledWith([
      { scopeKind: "day", scopeIndex: 1, planKind: "part_of_day", planStart: 2, planEnd: 2 },
    ]);
  });

  it("removes an existing pair", () => {
    const pair: FlowCyclePair = { scopeKind: "day", scopeIndex: 3, planKind: null, planStart: null, planEnd: null };
    render(<FlowCycleField {...base} value={[pair]} />);
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
