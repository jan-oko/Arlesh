import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ActionBar from "./ActionBar";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useViewStore } from "@/stores/use-view-store";
import { surfaceCommand } from "@/test/surface-command";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function publish(commands: readonly SurfaceCommand[]) {
  useCommandSurfaceStore.setState({ tables: new Map([["view", commands]]), revision: 1 });
}

beforeEach(() => {
  useViewStore.setState({ view: "list" });
  useSelectionSurfaceStore.setState({ kinds: [] });
  usePaletteStore.setState({ isOpen: false });
  publish([]);
});

describe("ActionBar", () => {
  it("draws a selected Task's slots, then More", () => {
    useSelectionSurfaceStore.setState({ kinds: ["task"] });
    render(<ActionBar />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "✓actionStatus", "＋actionChild", "▦actionPlan", "⇢actionDependency", "↗actionOpen", "⋯actionMore",
    ]);
  });

  it("runs the view's own binding for a slot — the List View's status cycle", () => {
    const cycle = surfaceCommand("listView.cycleStatus", "cycleRowStatus");
    publish([cycle]);
    useSelectionSurfaceStore.setState({ kinds: ["task"] });
    render(<ActionBar />);
    fireEvent.click(screen.getByRole("button", { name: "actionStatus" }));
    expect(cycle.run).toHaveBeenCalledTimes(1);
  });

  it("draws a slot disabled while its binding's guard says no", () => {
    publish([surfaceCommand("listView.cycleStatus", "cycleRowStatus", { canRun: () => false })]);
    useSelectionSurfaceStore.setState({ kinds: ["task"] });
    render(<ActionBar />);
    expect(screen.getByRole("button", { name: "actionStatus" })).toBeDisabled();
  });

  it("opens the command palette from More", () => {
    render(<ActionBar />);
    fireEvent.click(screen.getByRole("button", { name: "actionMore" }));
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("opens the Plan View's Kind as a sheet of the kinds that can act, and runs the one chosen", () => {
    useViewStore.setState({ view: "plan" });
    const week = surfaceCommand("planView.kind.week", "planKindWeek");
    publish([surfaceCommand("planView.kind.month", "planKindMonth"), week]);
    render(<ActionBar />);
    fireEvent.click(screen.getByRole("button", { name: "actionKind" }));
    fireEvent.click(screen.getByRole("button", { name: /planKindWeek/ }));
    expect(week.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
