import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence, type RecurrenceUi } from "./recurrence-ui";

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

const HABIT: RecurrenceUi = { ...defaultRecurrence("2026-01-05"), isHabit: true };

interface Overrides {
  value?: RecurrenceUi;
  onChange?: (value: RecurrenceUi) => void;
  durationKind?: string | null;
  scoped?: boolean;
}

function field(overrides: Overrides = {}) {
  return (
    <RecurrenceField
      value={overrides.value ?? HABIT}
      onChange={overrides.onChange ?? vi.fn()}
      durationKind={overrides.durationKind === undefined ? "week" : overrides.durationKind}
      scoped={overrides.scoped ?? true}
    />
  );
}

describe("RecurrenceField", () => {
  it("hides the recurrence config until the habit toggle is enabled", () => {
    const onChange = vi.fn();
    render(field({ value: defaultRecurrence("2026-01-05"), onChange }));
    expect(screen.queryByRole("button", { name: "clockWindow" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "makeHabit" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ isHabit: true }));
  });

  it("puts the clock first, then the miss policy, then Starts, the Gap and the end", () => {
    const { container } = render(field());
    const order = ["clockWindow", "missPolicyOverdue", "recurrenceStart", "recurrenceGap", "recurrenceEnd"];
    const text = container.textContent ?? "";
    const positions = order.map((key) => text.indexOf(key));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("offers a miss policy only under a Window clock, and hides it under Interval", () => {
    const { rerender } = render(field());
    expect(screen.getByRole("button", { name: "clockWindow" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "missPolicyOverdue" })).toBeInTheDocument();

    rerender(field({ value: { ...HABIT, clock: "interval" } }));
    expect(screen.queryByRole("group", { name: "missPolicy" })).not.toBeInTheDocument();
  });

  it("puts each choice's explanation in its tooltip rather than on the page", () => {
    render(field());
    expect(screen.getByRole("button", { name: "clockInterval" })).toHaveAttribute("title", "clockIntervalHint");
    expect(screen.getByRole("button", { name: "missPolicyOwed" })).toHaveAttribute("title", "missPolicyOwedHint");
    expect(screen.queryByText("clockIntervalHint")).not.toBeInTheDocument();
  });

  it("reports the picked clock and miss policy", () => {
    const onChange = vi.fn();
    render(field({ onChange }));
    fireEvent.click(screen.getByRole("button", { name: "missPolicyOwed" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ missPolicy: "owed" }));
    fireEvent.click(screen.getByRole("button", { name: "clockInterval" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ clock: "interval" }));
  });

  it("offers no clock choice on an Unscoped Habit, which can only keep an Interval", () => {
    render(field({ durationKind: null, scoped: false }));
    expect(screen.queryByRole("button", { name: "clockWindow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "missPolicy" })).not.toBeInTheDocument();
  });

  it("toggling the gap on reports it enabled", () => {
    const onChange = vi.fn();
    render(field({ onChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: "recurrenceGap" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gapEnabled: true }));
  });

  it("anchors the start/end pickers to the flow's Duration kind", () => {
    render(field({ value: { ...defaultRecurrence("2026-07-05"), isHabit: true, endEnabled: true, endDate: "2026-08-02" } }));
    // Both the start and end anchors render as week-formatted labels ("W{n} {year}"), not raw dates.
    expect(screen.getAllByText(/^W\d+ 2026$/).length).toBe(2);
  });
});
