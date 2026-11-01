import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CommandPalette from "./CommandPalette";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { surfaceCommand } from "@/test/surface-command";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function publish(commands: readonly SurfaceCommand[]) {
  useCommandSurfaceStore.setState({ tables: new Map([["view", commands]]), revision: 1 });
}

beforeEach(() => {
  usePaletteStore.setState({ isOpen: true });
});

describe("CommandPalette", () => {
  it("lists every command that can act now, with its key", () => {
    publish([
      surfaceCommand("listView.undo", "undo", { chord: { code: "KeyZ", ctrl: true } }),
      surfaceCommand("listView.delete", "delete", { canRun: () => false }),
    ]);
    render(<CommandPalette showTabs />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["hotkeys:undoCtrl+Z"]);
  });

  it("narrows the list to what the search names, by words or by key", () => {
    publish([
      surfaceCommand("listView.undo", "undo", { chord: { code: "KeyZ", ctrl: true } }),
      surfaceCommand("listView.redo", "redo", { chord: { code: "KeyZ", ctrl: true, shift: true } }),
    ]);
    render(<CommandPalette showTabs />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "shift" } });
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual(["hotkeys:redoCtrl+Shift+Z"]);
  });

  it("closes and runs the command chosen", () => {
    const undo = surfaceCommand("listView.undo", "undo");
    publish([undo]);
    render(<CommandPalette showTabs />);
    fireEvent.click(screen.getByRole("button", { name: /hotkeys:undo/ }));
    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(undo.run).toHaveBeenCalledTimes(1);
  });

  it("says so when nothing can act", () => {
    publish([]);
    render(<CommandPalette showTabs />);
    expect(screen.getByText("paletteEmpty")).toBeInTheDocument();
  });
});
