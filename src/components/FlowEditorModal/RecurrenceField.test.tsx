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
  durationN?: number;
  scoped?: boolean;
}

function field(overrides: Overrides = {}) {
  return (
    <RecurrenceField
      value={overrides.value ?? HABIT}
      onChange={overrides.onChange ?? vi.fn()}
      durationKind={overrides.durationKind === undefined ? "week" : overrides.durationKind}
      durationN={overrides.durationN ?? 1}
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

  it("puts the clock first, then the miss policy, then Starts, the Gap, the Cooldown and the end", () => {
    const { container } = render(field());
    const order = ["clockWindow", "missPolicyOverdue", "recurrenceStart", "recurrenceGap", "recurrenceCooldown", "recurrenceEnd"];
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

  it("offers a cooldown only under a Window clock", () => {
    const { rerender } = render(field());
    expect(screen.getByRole("checkbox", { name: "recurrenceCooldown" })).toBeInTheDocument();
    rerender(field({ value: { ...HABIT, clock: "interval" } }));
    expect(screen.queryByRole("checkbox", { name: "recurrenceCooldown" })).not.toBeInTheDocument();
  });

  it("offers no cooldown on a sub-day window, which has nothing finer to count in", () => {
    render(field({ durationKind: "part" }));
    expect(screen.queryByRole("checkbox", { name: "recurrenceCooldown" })).not.toBeInTheDocument();
  });

  it("counts a weekly habit's cooldown in days, short of a week", () => {
    render(field({ value: { ...HABIT, cooldownEnabled: true, cooldownN: 2 } }));
    expect(screen.getByRole("spinbutton", { name: "recurrenceCooldown" })).toHaveAttribute("max", "6");
    expect(screen.getByRole("combobox", { name: "recurrenceCooldown" })).toHaveValue("day");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["cooldownUnitDay"]);
  });

  it("counts a daily habit's cooldown in parts of the day", () => {
    render(field({ durationKind: "day", value: { ...HABIT, cooldownEnabled: true, cooldownKind: "day" } }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["cooldownUnitPart"]);
  });

  it("offers a monthly habit weeks or days, with room for the week that straddles the month", () => {
    render(field({ durationKind: "month", value: { ...HABIT, cooldownEnabled: true, cooldownKind: "week" } }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["cooldownUnitWeek", "cooldownUnitDay"]);
    expect(screen.getByRole("spinbutton", { name: "recurrenceCooldown" })).toHaveAttribute("max", "3");
  });

  it("reports the cooldown switched on", () => {
    const onChange = vi.fn();
    render(field({ onChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: "recurrenceCooldown" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cooldownEnabled: true, cooldownKind: "day" }));
  });
});
