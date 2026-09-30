import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence } from "./recurrence-ui";

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

describe("RecurrenceField", () => {
  it("hides the recurrence config until the habit toggle is enabled", () => {
    const onChange = vi.fn();
    render(<RecurrenceField value={defaultRecurrence("2026-01-05")} onChange={onChange} durationKind="week" scoped />);
    expect(screen.queryByRole("button", { name: "clockWindow" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "makeHabit" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ isHabit: true }));
  });

  it("offers a miss policy only under a Window clock", () => {
    const base = { ...defaultRecurrence("2026-01-05"), isHabit: true };
    const { rerender } = render(<RecurrenceField value={base} onChange={vi.fn()} durationKind="week" scoped />);
    expect(screen.getByRole("button", { name: "clockWindow" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "missPolicyOverdue" })).toBeInTheDocument();

    rerender(<RecurrenceField value={{ ...base, clock: "interval" }} onChange={vi.fn()} durationKind="week" scoped />);
    expect(screen.queryByRole("button", { name: "missPolicyOverdue" })).not.toBeInTheDocument();
    expect(screen.getByText("clockIntervalHint")).toBeInTheDocument();
  });

  it("reports the picked clock and miss policy", () => {
    const onChange = vi.fn();
    const base = { ...defaultRecurrence("2026-01-05"), isHabit: true };
    render(<RecurrenceField value={base} onChange={onChange} durationKind="week" scoped />);
    fireEvent.click(screen.getByRole("button", { name: "missPolicyOwed" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ missPolicy: "owed" }));
    fireEvent.click(screen.getByRole("button", { name: "clockInterval" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ clock: "interval" }));
  });

  it("keeps an Unscoped Habit on an Interval clock and says why", () => {
    const base = { ...defaultRecurrence("2026-01-05"), isHabit: true };
    render(<RecurrenceField value={base} onChange={vi.fn()} durationKind={null} scoped={false} />);
    expect(screen.getByRole("button", { name: "clockWindow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "clockInterval" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "missPolicyArchive" })).not.toBeInTheDocument();
    expect(screen.getByText("clockWindowNeedsScope")).toBeInTheDocument();
  });

  it("toggling the gap on reports it enabled", () => {
    const onChange = vi.fn();
    render(
      <RecurrenceField
        value={{ ...defaultRecurrence("2026-01-05"), isHabit: true }}
        onChange={onChange}
        durationKind="week"
        scoped
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "recurrenceGap" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gapEnabled: true }));
  });

  it("anchors the start/end pickers to the flow's Duration kind", () => {
    const value = { ...defaultRecurrence("2026-07-05"), isHabit: true, endEnabled: true, endDate: "2026-08-02" };
    render(<RecurrenceField value={value} onChange={vi.fn()} durationKind="week" scoped />);
    // Both the start and end anchors render as week-formatted labels ("W{n} {year}"), not raw dates.
    expect(screen.getAllByText(/^W\d+ 2026$/).length).toBe(2);
  });
});
