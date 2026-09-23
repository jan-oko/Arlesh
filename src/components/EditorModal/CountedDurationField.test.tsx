import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CountedDurationField from "./CountedDurationField";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("CountedDurationField", () => {
  it("clears a set value back to none with one click", () => {
    const onChange = vi.fn();
    render(<CountedDurationField value={{ n: 3, kind: "day" }} onChange={onChange} label="every" emptyLabel="never" />);
    fireEvent.click(screen.getByRole("button", { name: "scopeClear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("offers no Clear when there is nothing to clear", () => {
    render(<CountedDurationField value={null} onChange={vi.fn()} label="every" emptyLabel="never" />);
    expect(screen.queryByRole("button", { name: "scopeClear" })).toBeNull();
  });
});

describe("CountedDurationField — hours and minutes", () => {
  it("offers hours and minutes only when asked, and sets them as the kind", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CountedDurationField value={{ n: 3, kind: "day" }} onChange={onChange} label="every" emptyLabel="never" />);
    expect(screen.queryByRole("button", { name: "kindHour" })).toBeNull();
    rerender(<CountedDurationField value={{ n: 3, kind: "day" }} onChange={onChange} label="every" emptyLabel="never" subDay />);
    fireEvent.click(screen.getByRole("button", { name: "kindHour" }));
    expect(onChange).toHaveBeenLastCalledWith({ n: 3, kind: "hour" });
    fireEvent.click(screen.getByRole("button", { name: "kindMinute" }));
    expect(onChange).toHaveBeenLastCalledWith({ n: 3, kind: "minute" });
  });
});
