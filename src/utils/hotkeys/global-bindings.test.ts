import { describe, it, expect, vi } from "vitest";
import { GLOBAL_BINDINGS } from "./global-bindings";
import type { GlobalContext } from "./global-bindings";
import { matchesChord } from "./chord";

function makeContext(overrides: Partial<GlobalContext> = {}): GlobalContext {
  return {
    onToggleView: vi.fn(),
    onToggleHotkeys: vi.fn(),
    onToggleFullscreen: vi.fn(),
    isRecursiveExpandArmed: false,
    onQuit: vi.fn(),
    ...overrides,
  };
}

function runFor(code: string, modifiers: Partial<KeyboardEventInit>, ctx: GlobalContext): boolean {
  const event = new KeyboardEvent("keydown", { code, ...modifiers });
  const binding = GLOBAL_BINDINGS.find((b) => matchesChord(event, b.chord) && (b.when === undefined || b.when(ctx)));
  if (binding === undefined) return false;
  binding.run(ctx);
  return true;
}

describe("GLOBAL_BINDINGS", () => {
  it("when Alt+L is pressed, toggles the view", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { altKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleView).toHaveBeenCalledTimes(1);
  });

  it("when Ctrl+Shift+/ is pressed, toggles the cheat-sheet", () => {
    const ctx = makeContext();
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleHotkeys).toHaveBeenCalledTimes(1);
  });

  it("when Ctrl+Shift+/ is pressed with the Mindmap's recursive expand armed, leaves it alone", () => {
    const ctx = makeContext({ isRecursiveExpandArmed: true });
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(false);
    expect(ctx.onToggleHotkeys).not.toHaveBeenCalled();
  });

  it("when F11 is pressed, shows the board alone", () => {
    const ctx = makeContext();
    expect(runFor("F11", {}, ctx)).toBe(true);
    expect(ctx.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("when Ctrl+Q is pressed, quits the app", () => {
    const ctx = makeContext();
    expect(runFor("KeyQ", { ctrlKey: true }, ctx)).toBe(true);
    expect(ctx.onQuit).toHaveBeenCalledTimes(1);
  });

  it("when Q is pressed on its own, quits nothing", () => {
    const ctx = makeContext();
    expect(runFor("KeyQ", {}, ctx)).toBe(false);
    expect(ctx.onQuit).not.toHaveBeenCalled();
  });

  it("does not repeat the quit while Ctrl+Q is held", () => {
    const quit = GLOBAL_BINDINGS.find((b) => b.id === "global.quit");
    expect(quit?.allowRepeat).toBe(false);
  });

  it("when Alt+Shift+L is pressed, matches nothing", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { altKey: true, shiftKey: true }, ctx)).toBe(false);
  });

  it("every binding carries a label key in the hotkeys namespace", () => {
    for (const binding of GLOBAL_BINDINGS) {
      expect(binding.labelKey).not.toBe("");
      expect(binding.section).toBe("global");
    }
  });
});
