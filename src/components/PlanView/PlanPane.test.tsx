import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlanPane from "./PlanPane";
import type { PlanSection } from "@/utils/plan-sections";
import type { PaneModel } from "@/utils/plan-pane-model";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, string>) => (options === undefined ? key : `${key} ${options["start"] ?? ""}`) }),
}));

function section(key: string, partial: boolean): PlanSection {
  return {
    key,
    ref: { kind: "week", date: "2026-09-27" },
    range: { startDate: "2026-09-27", endDate: "2026-10-03" },
    partial,
    rows: [],
  };
}

describe("a phone planned pane in tabs", () => {
  it("marks a partial bucket's tab, and only that one", () => {
    const sections = [section("a", false), section("b", true)];
    const model: PaneModel = {
      blocks: sections.map((s) => ({ key: s.key, section: s, entries: [] })),
      rows: [],
      sectioned: true,
    };
    render(
      <PlanPane
        which="planned" heading="Planned" options={[]} model={model} focused={false} grouped={false}
        selectedIds={new Set()} direction="out" empty={null} nativeDrag={false} touchOver={null}
        tabsFor="scope" overlay={null}
        sectionInfo={new Map([["a", { label: "W39", keys: { digit: 1, letter: null } }], ["b", { label: "W40", keys: { digit: 2, letter: null } }]])}
        onFocus={vi.fn()} onSelect={vi.fn()} onMove={vi.fn()} onOpenEditor={vi.fn()} onEnterSubtree={vi.fn()}
        onFilterByAntecedent={vi.fn()} onDragStart={vi.fn()} onDrop={vi.fn()}
      />,
    );
    const [first, second] = screen.getAllByRole("tab");
    expect(first?.querySelector('[role="img"]')).toBeNull();
    expect(second?.querySelector('[role="img"]')).not.toBeNull();
  });
});
