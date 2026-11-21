import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CommandPalette from "./CommandPalette";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useBoardStore } from "@/stores/use-board-store";
import { sendAnswerDrafts } from "@/api/answer-drafts";
import { storedRowId } from "@/test/stored-id";
import { surfaceCommand } from "@/test/surface-command";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`) }),
}));
vi.mock("@/api/answer-drafts", () => ({ saveAnswerDraft: vi.fn(), clearAnswerDraft: vi.fn(), sendAnswerDrafts: vi.fn() }));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  withGesture: (_name: string, run: () => Promise<unknown>) => run(),
}));

function publish(commands: readonly SurfaceCommand[]) {
  useCommandSurfaceStore.setState({ tables: new Map([["view", commands]]), revision: 1 });
}

beforeEach(() => {
  usePaletteStore.setState({ isOpen: true });
  useAgentActivityStore.setState({ stagedWaitIds: [] });
  useBoardStore.setState({ settle: () => Promise.resolve() });
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

  it("opens with the search focused, and keeps it there, so the keyboard comes up", () => {
    publish([]);
    render(<CommandPalette showTabs />);
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("says so when nothing can act", () => {
    publish([]);
    render(<CommandPalette showTabs />);
    expect(screen.getByText("paletteEmpty")).toBeInTheDocument();
  });

  it("offers no Send entry while nothing is staged", () => {
    publish([]);
    render(<CommandPalette showTabs />);
    expect(screen.queryByRole("button", { name: /paletteSendStaged/ })).not.toBeInTheDocument();
  });

  it("offers Send for the staged answers, with their number, and closes and sends when chosen", async () => {
    vi.mocked(sendAnswerDrafts).mockResolvedValue({ sent: [], skipped: [] });
    const staged = [storedRowId(3), storedRowId(4), storedRowId(5)];
    useAgentActivityStore.setState({ stagedWaitIds: staged });
    publish([]);
    render(<CommandPalette showTabs />);

    fireEvent.click(screen.getByRole("button", { name: "paletteSendStaged:3" }));

    expect(usePaletteStore.getState().isOpen).toBe(false);
    await vi.waitFor(() => expect(sendAnswerDrafts).toHaveBeenCalledWith({ shown: staged }));
  });
});
