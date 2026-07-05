import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardListView } from "./use-keyboard-list-view";

/** Physical-key code for a produced character, mirroring what a browser sets on the event. */
function keyToCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  return key; // Arrow*, Enter, Escape — code === key
}

function fireKey(key: string, modifiers: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: keyToCode(key), bubbles: true, cancelable: true, ...modifiers }));
}

function baseOptions(overrides: Partial<Parameters<typeof useKeyboardListView>[0]> = {}) {
  return {
    isInputActive: false,
    selectedTaskId: "task-1" as string | null,
    isSelectedBlocked: false,
    onNavigate: vi.fn(),
    onCycleStatus: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartRename: vi.fn(),
    onDeselect: vi.fn(),
    onToggleFilter: vi.fn(),
    onSetStatusMode: vi.fn(),
    ...overrides,
  };
}

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  addSpy = vi.spyOn(window, "addEventListener");
  removeSpy = vi.spyOn(window, "removeEventListener");
});

afterEach(() => {
  addSpy.mockRestore();
  removeSpy.mockRestore();
});

describe("useKeyboardListView", () => {
  it("registers and cleans up a capturing keydown listener", () => {
    const { unmount } = renderHook((opts) => useKeyboardListView(opts), { initialProps: baseOptions() });
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
  });

  it("Alt+F toggles the filter menu", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("f", { altKey: true });
    expect(options.onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a", "all"],
    ["p", "plan"],
    ["s", "start"],
    ["d", "do"],
  ] as const)("Alt+%s sets the %s status preset", (key, mode) => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey(key, { altKey: true });
    expect(options.onSetStatusMode).toHaveBeenCalledWith(mode);
  });

  it("ArrowDown/ArrowUp navigate the selection", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("ArrowDown");
    expect(options.onNavigate).toHaveBeenCalledWith(1);
    fireKey("ArrowUp");
    expect(options.onNavigate).toHaveBeenCalledWith(-1);
  });

  it("Enter cycles the selected row's status when not blocked", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("Enter does nothing when the selected row is blocked", () => {
    const options = baseOptions({ isSelectedBlocked: true });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("Enter does nothing when nothing is selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("E opens the editor for the selected row", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    expect(options.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("R starts renaming the selected row", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("r");
    expect(options.onStartRename).toHaveBeenCalledWith("task-1");
  });

  it("Escape deselects when something is selected", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when nothing is selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("ignores every binding while an input is active", () => {
    const options = baseOptions({ isInputActive: true });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    fireKey("r");
    fireKey("ArrowDown");
    fireKey("f", { altKey: true });
    expect(options.onOpenEditor).not.toHaveBeenCalled();
    expect(options.onStartRename).not.toHaveBeenCalled();
    expect(options.onNavigate).not.toHaveBeenCalled();
    expect(options.onToggleFilter).not.toHaveBeenCalled();
  });

  it("E/R with no selection do nothing", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    fireKey("r");
    expect(options.onOpenEditor).not.toHaveBeenCalled();
    expect(options.onStartRename).not.toHaveBeenCalled();
  });
});
