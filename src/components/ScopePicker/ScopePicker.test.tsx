import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen, fireEvent } from "@testing-library/react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";
import ScopePicker from "./ScopePicker";
import type { UseScopePicker } from "@/hooks/use-scope-picker";
import type { ScopeRef } from "@/utils/scope-ref";

function stubPicker(overrides: Partial<UseScopePicker> = {}): UseScopePicker {
  return {
    mode: "single",
    single: null,
    range: { start: null, end: null },
    handleClick: vi.fn(),
    adjustEndpoint: vi.fn(),
    reset: vi.fn(),
    seed: vi.fn(),
    resolve: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const NOW = new Date("2026-06-15T10:00:00Z");

describe("ScopePicker — rendering & selection", () => {
  it("renders the twelve months at the month view", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    expect(screen.getByRole("button", { name: "January 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "December 2026" })).toBeInTheDocument();
  });

  it("clicking a cell applies the click with the cell's scope ref", () => {
    const picker = stubPicker();
    render(<ScopePicker picker={picker} initialKind="month" now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "June 2026" }));
    const expected: ScopeRef = { kind: "month", date: "2026-06-01" };
    expect(picker.handleClick).toHaveBeenCalledWith(expected);
  });

  it("marks the cell containing today with aria-current", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-current", "date");
    expect(screen.getByRole("button", { name: "May 2026" })).not.toHaveAttribute("aria-current");
  });

  it("marks the selected cell as pressed", () => {
    const picker = stubPicker({ single: { kind: "month", date: "2026-06-01" } });
    render(<ScopePicker picker={picker} initialKind="month" now={NOW} />);
    expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "May 2026" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ScopePicker — navigation", () => {
  it("double-clicking a month descends into its weeks", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "June 2026" }));
    // Week view of June: several "Week N" cells appear.
    expect(screen.getAllByText(/^Week \d+$/).length).toBeGreaterThan(0);
  });

  it("browses to the next year", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByRole("button", { name: "June 2027" })).toBeInTheDocument();
  });

  it("ascends from month to season", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    expect(screen.getByRole("button", { name: "Summer 2026" })).toBeInTheDocument();
  });

  it("disables the up button at the coarsest (season) view", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="season" now={NOW} />);
    expect(screen.getByRole("button", { name: "up" })).toBeDisabled();
  });
});

describe("ScopePicker — lockKind", () => {
  it("hides the up button", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="week" now={NOW} lockKind />);
    expect(screen.queryByRole("button", { name: "up" })).not.toBeInTheDocument();
  });

  it("does not descend on double-click", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} lockKind />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "June 2026" }));
    expect(screen.getByRole("button", { name: "June 2026" })).toBeInTheDocument();
    expect(screen.queryAllByText(/^Week \d+$/).length).toBe(0);
  });
});

describe("ScopePicker — constraint", () => {
  it("disables cells outside the inclusive date range", () => {
    render(
      <ScopePicker
        picker={stubPicker()}
        initialKind="month"
        now={NOW}
        constraint={{ startDate: "2026-06-01", endDate: "2026-06-30" }}
      />,
    );
    expect(screen.getByRole("button", { name: "June 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "July 2026" })).toBeDisabled();
  });
});

describe("ScopePicker — opening view", () => {
  it("opens on the given anchor, not on today", () => {
    render(
      <ScopePicker picker={stubPicker()} initialKind="day" initialAnchor="2026-09-16" now={NOW} />,
    );
    // The week of Wednesday 16 September 2026 runs 13–19.
    expect(screen.getByRole("button", { name: "13" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "19" })).toBeInTheDocument();
  });
});

describe("ScopePicker — current part of day", () => {
  function renderParts(anchor: string, now: Date) {
    render(
      <ScopePicker picker={stubPicker()} initialKind="part_of_day" initialAnchor={anchor} now={now} />,
    );
  }

  function currentParts(): string[] {
    return screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "date")
      .map((button) => button.textContent ?? "");
  }

  it("marks only the part holding the current hour", () => {
    renderParts("2026-06-15", new Date("2026-06-15T10:00:00Z"));
    expect(currentParts()).toEqual(["Morning"]);
  });

  it("marks no part on a date that is not the current one", () => {
    renderParts("2026-06-14", new Date("2026-06-15T10:00:00Z"));
    expect(currentParts()).toEqual([]);
  });

  it("at 00:30 marks the previous date's Night, not the displayed date's", () => {
    renderParts("2026-06-14", new Date("2026-06-15T00:30:00Z"));
    expect(currentParts()).toEqual(["Night"]);
  });

  it("at 00:30 marks nothing on the date the clock reads", () => {
    renderParts("2026-06-15", new Date("2026-06-15T00:30:00Z"));
    expect(currentParts()).toEqual([]);
  });
});

describe("ScopePicker — the keyboard", () => {
  /** The grid the keys act on, and the cell its highlight is on. */
  function grid(): HTMLElement {
    return screen.getByRole("group");
  }
  function highlighted(): string | null {
    const id = grid().getAttribute("aria-activedescendant");
    return id === null ? null : document.getElementById(id)?.textContent ?? null;
  }
  function key(code: string, extra: { ctrlKey?: boolean } = {}): void {
    fireEvent.keyDown(grid(), { code, ...extra });
  }

  it("starts the highlight on the present, and takes the focus when asked", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} autoFocus />);
    expect(grid()).toHaveFocus();
    expect(highlighted()).toBe("June 2026");
  });

  it("starts the highlight on the selection when there is one", () => {
    const picker = stubPicker({ single: { kind: "month", date: "2026-03-01" } });
    render(<ScopePicker picker={picker} initialKind="month" now={NOW} />);
    expect(highlighted()).toBe("March 2026");
  });

  it("moves the highlight over the grid with the arrows, four cells to a row, stopping at the edges", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    key("ArrowRight");
    expect(highlighted()).toBe("July 2026");
    key("ArrowDown");
    expect(highlighted()).toBe("November 2026");
    key("ArrowDown");
    expect(highlighted()).toBe("November 2026");
    key("ArrowLeft");
    expect(highlighted()).toBe("October 2026");
    key("ArrowUp");
    expect(highlighted()).toBe("June 2026");
  });

  it("Space picks the highlighted cell, exactly as a click does", () => {
    const picker = stubPicker();
    render(<ScopePicker picker={picker} initialKind="month" now={NOW} />);
    key("ArrowLeft");
    key("Space");
    expect(picker.handleClick).toHaveBeenCalledWith({ kind: "month", date: "2026-05-01" });
  });

  it("Space will not pick a cell outside the constraint", () => {
    const picker = stubPicker();
    render(
      <ScopePicker picker={picker} initialKind="month" now={NOW} constraint={{ startDate: "2026-06-01", endDate: "2026-06-30" }} />,
    );
    key("ArrowRight");
    key("Space");
    expect(picker.handleClick).not.toHaveBeenCalled();
  });

  it("Enter steps into the highlighted cell rather than picking it", () => {
    const picker = stubPicker();
    render(<ScopePicker picker={picker} initialKind="month" now={NOW} />);
    key("Enter");
    expect(picker.handleClick).not.toHaveBeenCalled();
    expect(grid()).toHaveAccessibleName(expect.stringContaining("June 2026"));
    expect(screen.queryByRole("button", { name: "July 2026" })).not.toBeInTheDocument();
  });

  it("[ and ] show the previous and next period, keeping the highlight's place", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    key("BracketRight");
    expect(highlighted()).toBe("June 2027");
    key("BracketLeft");
    key("BracketLeft");
    expect(highlighted()).toBe("June 2025");
  });

  it("\\ goes up one level, landing the highlight on the cell it came out of", () => {
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} />);
    key("Backslash");
    expect(screen.getByRole("button", { name: "Summer 2026" })).toBeInTheDocument();
    expect(highlighted()).toBe("Summer 2026");
  });

  it("Ctrl+Enter commits where the caller has an Apply", () => {
    const onCommit = vi.fn();
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} onCommit={onCommit} />);
    key("Enter", { ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps [ ] \\ and Ctrl+Enter from a view's own bindings while the focus is inside it", () => {
    const viewKey = vi.fn();
    const bindings: Binding<null>[] = ["BracketLeft", "BracketRight", "Backslash"].map((code) => ({
      id: code, section: "planView", chord: { code }, labelKey: "planStepScope", run: viewKey,
    }));
    bindings.push({ id: "insert", section: "mindmap", chord: { code: "Enter", ctrl: true }, labelKey: "insertParent", run: viewKey });
    renderHook(() => useHotkeys(bindings, null, true));
    render(<ScopePicker picker={stubPicker()} initialKind="month" now={NOW} onCommit={vi.fn()} />);
    key("BracketRight");
    key("Backslash");
    key("Enter", { ctrlKey: true });
    expect(viewKey).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Summer 2027" })).toBeInTheDocument();
  });
});
