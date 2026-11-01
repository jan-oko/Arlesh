import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys } from "./use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";
import { allSurfaceCommands, useCommandSurfaceStore } from "@/stores/use-command-surface-store";

interface Ctx {
  selected: string | null;
  onAct: (id: string) => void;
}

const BINDINGS: readonly Binding<Ctx>[] = [
  {
    id: "listView.act", section: "listView", chord: { code: "KeyX" }, labelKey: "undo",
    when: (c) => c.selected !== null,
    run: (c) => { if (c.selected !== null) c.onAct(c.selected); },
  },
];

function published() {
  return allSurfaceCommands(useCommandSurfaceStore.getState().tables);
}

beforeEach(() => {
  useCommandSurfaceStore.setState({ tables: new Map(), revision: 0 });
});

describe("useHotkeys publishes its table to the command surface", () => {
  it("publishes each binding with its key and words", () => {
    renderHook(() => useHotkeys(BINDINGS, { selected: null, onAct: vi.fn() }, true));
    expect(published().map((command) => [command.id, command.chord, command.label])).toEqual([
      ["listView.act", { code: "KeyX" }, { namespace: "hotkeys", key: "undo" }],
    ]);
  });

  it("runs the binding against the latest context, behind its guard", () => {
    const onAct = vi.fn();
    const initialProps: { selected: string | null } = { selected: null };
    const { rerender } = renderHook(({ selected }: { selected: string | null }) =>
      useHotkeys(BINDINGS, { selected, onAct }, true), { initialProps });
    const [command] = published();
    expect(command?.canRun()).toBe(false);

    rerender({ selected: "task-1" });
    expect(command?.canRun()).toBe(true);
    command?.run();
    expect(onAct).toHaveBeenCalledWith("task-1");
  });

  it("cannot run while the table is disabled, as its key cannot", () => {
    renderHook(() => useHotkeys(BINDINGS, { selected: "task-1", onAct: vi.fn() }, false));
    expect(published()[0]?.canRun()).toBe(false);
  });

  it("withdraws the table when the view unmounts", () => {
    const { unmount } = renderHook(() => useHotkeys(BINDINGS, { selected: null, onAct: vi.fn() }, true));
    unmount();
    expect(published()).toEqual([]);
  });

  it("bumps the revision on a re-render, so the action bar asks its slots again", () => {
    const { rerender } = renderHook(() => useHotkeys(BINDINGS, { selected: null, onAct: vi.fn() }, true));
    const before = useCommandSurfaceStore.getState().revision;
    rerender();
    expect(useCommandSurfaceStore.getState().revision).toBeGreaterThan(before);
  });
});
