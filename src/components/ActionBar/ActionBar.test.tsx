import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ActionBar from "./ActionBar";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useViewStore } from "@/stores/use-view-store";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { surfaceCommand } from "@/test/surface-command";
import { LONG_PRESS_MS } from "@/utils/touch/gestures";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function publish(commands: readonly SurfaceCommand[]) {
  useCommandSurfaceStore.setState({ tables: new Map([["view", commands]]), revision: 1 });
}

beforeEach(() => {
  useViewStore.setState({ view: "list" });
  useSelectionSurfaceStore.setState({ kinds: [], multiSelect: false });
  usePaletteStore.setState({ isOpen: false });
  useClientModeStore.setState({ status: null });
  publish([]);
});

describe("ActionBar", () => {
  it("draws a selected Task's slots, then More", () => {
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
    render(<ActionBar />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "actionStatus", "actionChild", "actionPlan", "actionDependency", "actionEdit", "actionMore",
    ]);
  });

  it("draws the status action with the Started Task's icon and the filter with a filter icon", () => {
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
    const { container, rerender } = render(<ActionBar />);
    const status = container.querySelector('[data-action-icon="status"]');
    // TaskIcon's Started glyph: the ring and the unfilled inner circle.
    expect(status?.querySelectorAll("circle")).toHaveLength(2);
    expect(status?.querySelector("circle[fill='currentColor']")).toBeNull();
    useSelectionSurfaceStore.setState({ kinds: [], multiSelect: false });
    rerender(<ActionBar />);
    expect(container.querySelector('[data-action-icon="filter"]')).not.toBeNull();
  });

  it("draws Up, not Child, with nothing selected; it runs the subtree exit and is greyed when it cannot", () => {
    const exit = surfaceCommand("global.exitSubtree", "exitSubtree");
    publish([exit]);
    const { container } = render(<ActionBar />);
    expect(screen.queryByRole("button", { name: "actionChild" })).not.toBeInTheDocument();
    expect(container.querySelector('[data-action-icon="up"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "actionUp" }));
    expect(exit.run).toHaveBeenCalledTimes(1);
  });

  it("greys Up at the top level, where no subtree is entered to leave", () => {
    publish([]);
    render(<ActionBar />);
    expect(screen.getByRole("button", { name: "actionUp" })).toBeDisabled();
  });

  describe("a long-press on Child", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function typed(kind: string) {
      return surfaceCommand(`mindmap.createTypedChild.${kind}`, "createChild");
    }

    it("opens a picker of the kinds the selected node can parent, and a pick runs that kind's command", () => {
      useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
      const task = typed("task");
      const goal = typed("goal");
      const flow = typed("flow");
      const info = typed("info");
      publish([surfaceCommand("mindmap.createChild", "createChild"), task, goal, flow, info]);
      render(<ActionBar />);
      const child = screen.getByRole("button", { name: "actionChild" });
      fireEvent.pointerDown(child);
      act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
      const names = screen.getAllByRole("button").map((button) => button.textContent);
      // A Task holds Tasks and Infos, never a Goal or a Flow.
      expect(names).toContain("info");
      expect(names).toContain("task");
      expect(names).not.toContain("goal");
      expect(names).not.toContain("flow");
      fireEvent.pointerUp(child);
      fireEvent.click(child);
      expect(task.run).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "info" }));
      expect(info.run).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "info" })).not.toBeInTheDocument();
    });

    it("leaves a tap as it was: the plain Child command, and no picker", () => {
      useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
      const child = surfaceCommand("mindmap.createChild", "createChild");
      publish([child, typed("info")]);
      render(<ActionBar />);
      const button = screen.getByRole("button", { name: "actionChild" });
      fireEvent.pointerDown(button);
      act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 100); });
      fireEvent.pointerUp(button);
      fireEvent.click(button);
      expect(child.run).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "info" })).not.toBeInTheDocument();
    });

    it("offers only Task where a view has only Tab, such as the List View", () => {
      useSelectionSurfaceStore.setState({ kinds: ["project"], multiSelect: false });
      const create = surfaceCommand("listView.createChild", "createChildRow");
      publish([create]);
      render(<ActionBar />);
      fireEvent.pointerDown(screen.getByRole("button", { name: "actionChild" }));
      act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
      fireEvent.click(screen.getByRole("button", { name: "task" }));
      expect(create.run).toHaveBeenCalledTimes(1);
    });
  });

  it("draws Edit in every view", () => {
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
    for (const view of ["mindmap", "list", "plan", "steps", "zen"] as const) {
      useViewStore.setState({ view });
      const { unmount } = render(<ActionBar />);
      expect(screen.getByRole("button", { name: "actionEdit" })).toBeInTheDocument();
      unmount();
    }
  });

  it("runs the view's own binding for a slot — the List View's status cycle", () => {
    const cycle = surfaceCommand("listView.cycleStatus", "cycleRowStatus");
    publish([cycle]);
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
    render(<ActionBar />);
    fireEvent.click(screen.getByRole("button", { name: "actionStatus" }));
    expect(cycle.run).toHaveBeenCalledTimes(1);
  });

  it("draws a slot disabled while its binding's guard says no", () => {
    publish([surfaceCommand("listView.cycleStatus", "cycleRowStatus", { canRun: () => false })]);
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
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

  it("draws the write slots disabled, and keeps the reads, while the server cannot be written", () => {
    useClientModeStore.setState({
      status: {
        mode: "client", first_run: false, api_version: 1, standalone_available: true,
        server: { url: "u", reachable: false, last_sync: null, read_only: "server_unreachable", server_api_version: null },
      },
    });
    publish([surfaceCommand("listView.cycleStatus", "cycleRowStatus"), surfaceCommand("global.openSearch", "openSearch")]);
    useSelectionSurfaceStore.setState({ kinds: ["task"], multiSelect: false });
    const { rerender } = render(<ActionBar />);
    expect(screen.getByRole("button", { name: "actionStatus" })).toBeDisabled();
    useSelectionSurfaceStore.setState({ kinds: [], multiSelect: false });
    rerender(<ActionBar />);
    expect(screen.getByRole("button", { name: "actionOpen" })).toBeEnabled();
  });
});
