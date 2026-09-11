import { describe, it, expect, vi } from "vitest";
import { GLOBAL_BINDINGS } from "./global-bindings";
import type { GlobalContext } from "./global-bindings";
import { matchesChord } from "./chord";

function makeContext(): GlobalContext {
  return { onToggleView: vi.fn(), onToggleHotkeys: vi.fn() };
}

function runFor(code: string, modifiers: Partial<KeyboardEventInit>, ctx: GlobalContext): boolean {
  const event = new KeyboardEvent("keydown", { code, ...modifiers });
  const binding = GLOBAL_BINDINGS.find((b) => matchesChord(event, b.chord));
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
