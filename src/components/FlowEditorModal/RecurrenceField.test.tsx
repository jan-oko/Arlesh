import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence, recurrenceSummaryParts, type RecurrenceUi } from "./recurrence-ui";

// Keys come back as themselves; an interpolated one lists its values after it, so the summary's
// parts can be read off the rendered text.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}(${Object.values(values).map(String).join("|")})`,
    i18n: { dir: () => "ltr" },
  }),
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
  durationN?: number;
  scoped?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

function field(overrides: Overrides = {}) {
  return (
    <RecurrenceField
      value={overrides.value ?? HABIT}
      onChange={overrides.onChange ?? vi.fn()}
      durationKind={overrides.durationKind === undefined ? "week" : overrides.durationKind}
      durationN={overrides.durationN ?? 1}
      scoped={overrides.scoped ?? true}
      expanded={overrides.expanded ?? true}
      onToggleExpanded={overrides.onToggleExpanded ?? vi.fn()}
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
    render(field());
    const bodyId = screen.getByRole("button", { expanded: true }).getAttribute("aria-controls") ?? "";
    const order = ["clockWindow", "missPolicyOverdue", "recurrenceStart", "recurrenceGap", "recurrenceEnd"];
    const text = document.getElementById(bodyId)?.textContent ?? "";
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
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("clockInterval");
  });

  it("folds into a one-line summary that a keyboard-operable toggle opens", () => {
    const onToggle = vi.fn();
    const { rerender } = render(field({ expanded: false, onToggleExpanded: onToggle }));
    const toggle = screen.getByRole("button", { expanded: false });
    expect(screen.queryByRole("button", { name: "clockWindow" })).not.toBeInTheDocument();
    expect(screen.queryByText("recurrenceStart")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(field({ expanded: true, onToggleExpanded: onToggle }));
    const open = screen.getByRole("button", { expanded: true });
    expect(open).toHaveAttribute("aria-controls");
    expect(screen.getByRole("button", { name: "clockWindow" })).toBeInTheDocument();
  });

  it("summarises cadence, clock and policy, gap and end", () => {
    render(field({
      expanded: false,
      value: { ...HABIT, missPolicy: "overdue", gapEnabled: true, gapN: 2, gapKind: "week" },
    }));
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent(
      "recurrenceSummary(cadenceWeek(1)|recurrenceSummaryClockPolicy(clockWindow|missPolicyOverdue)|"
      + "recurrenceSummaryGap(2|week)|recurrenceSummaryEndsNever)",
    );
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

describe("recurrenceSummaryParts", () => {
  it("reads what the editor would save", () => {
    expect(recurrenceSummaryParts(
      { ...HABIT, missPolicy: "owed", endEnabled: true, endDate: "2026-03-01" }, "week", 2, true,
    )).toEqual({
      cadence: "week", cadenceCount: 2, clock: "window", missPolicy: "owed", gap: null, endDate: "2026-03-01",
    });
  });

  it("reads an Unscoped Habit as Interval, with no miss policy", () => {
    expect(recurrenceSummaryParts({ ...HABIT, gapEnabled: true, gapN: 3, gapKind: "day" }, null, 1, false)).toEqual({
      cadence: "unscoped", cadenceCount: 1, clock: "interval", missPolicy: null, gap: { n: 3, kind: "day" }, endDate: null,
    });
  });

  it("reads a sub-day window as daily", () => {
    expect(recurrenceSummaryParts(HABIT, "part", 1, true).cadence).toBe("day");
  });
});
