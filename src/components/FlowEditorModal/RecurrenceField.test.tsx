import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecurrenceField from "./RecurrenceField";
import { defaultRecurrence } from "./recurrence-ui";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

describe("RecurrenceField", () => {
  it("hides the recurrence config until the habit toggle is enabled", () => {
    const onChange = vi.fn();
    render(<RecurrenceField value={defaultRecurrence("2026-01-05")} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "consumptionDestructive" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "makeHabit" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ isHabit: true }));
  });

  it("reveals the blocking sub-tree only under Accumulating, and catch-up only under Blocking", () => {
    const base = { ...defaultRecurrence("2026-01-05"), isHabit: true };
    const { rerender } = render(<RecurrenceField value={base} onChange={vi.fn()} />);

    // Destructive: no overlapping/blocking choice, no catch-up.
    expect(screen.queryByRole("button", { name: "blockingBlocking" })).not.toBeInTheDocument();

    rerender(<RecurrenceField value={{ ...base, consumptionKind: "accumulating" }} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "blockingBlocking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "catchupNext" })).not.toBeInTheDocument();

    rerender(
      <RecurrenceField
        value={{ ...base, consumptionKind: "accumulating", blockingMode: "blocking" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "catchupNext" })).toBeInTheDocument();
  });

  it("toggling the gap on reports it enabled", () => {
    const onChange = vi.fn();
    render(<RecurrenceField value={{ ...defaultRecurrence("2026-01-05"), isHabit: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "recurrenceGap" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gapEnabled: true }));
  });
});
