import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys } from "./use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";

interface TestContext {
  selected: string | null;
  onFirst: () => void;
  onSecond: () => void;
}

function fireKey(code: string, modifiers: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...modifiers }));
}

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
  return { selected: "node-1", onFirst: vi.fn(), onSecond: vi.fn(), ...overrides };
}

const BINDINGS: readonly Binding<TestContext>[] = [
  {
    id: "test.first", section: "global", chord: { code: "ArrowUp" }, labelKey: "viewList",
    when: (c) => c.selected !== null, run: (c) => c.onFirst(),
  },
  {
    id: "test.second", section: "global", chord: { code: "ArrowUp" }, labelKey: "deselect",
    run: (c) => c.onSecond(),
  },
];

describe("useHotkeys", () => {
  it("when a guard passes, runs the first matching binding and not the later one", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowUp");
    expect(ctx.onFirst).toHaveBeenCalledTimes(1);
    expect(ctx.onSecond).not.toHaveBeenCalled();
  });

  it("when the first binding's guard fails, falls through to the next same-chord binding", () => {
    const ctx = makeContext({ selected: null });
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
    expect(ctx.onSecond).toHaveBeenCalledTimes(1);
  });

  it("when disabled, runs nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, false));
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
  });

  it("when no binding matches the chord, does nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowDown");
    expect(ctx.onFirst).not.toHaveBeenCalled();
    expect(ctx.onSecond).not.toHaveBeenCalled();
  });

  it("when a matching binding runs, prevents the browser default", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    const event = new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("when the key is auto-repeating, skips a binding that opted out of repeat", () => {
    const onRepeatable = vi.fn();
    const ctx = makeContext();
    const bindings: readonly Binding<TestContext>[] = [{
      id: "test.norepeat", section: "global", chord: { code: "ArrowUp", ctrl: true }, labelKey: "zoomIn",
      allowRepeat: false, run: () => onRepeatable(),
    }];
    renderHook(() => useHotkeys(bindings, ctx, true));
    fireKey("ArrowUp", { ctrlKey: true, repeat: true });
    expect(onRepeatable).not.toHaveBeenCalled();
    fireKey("ArrowUp", { ctrlKey: true });
    expect(onRepeatable).toHaveBeenCalledTimes(1);
  });

  it("when unmounted, detaches its listener", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() => useHotkeys(BINDINGS, ctx, true));
    unmount();
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
  });

  it("when the event comes from a focused text input, runs nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true }));
    expect(ctx.onFirst).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
