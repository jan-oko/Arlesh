import { describe, it, expect, vi } from "vitest";
import { GLOBAL_BINDINGS } from "./global-bindings";
import type { GlobalContext } from "./global-bindings";
import { matchesChord } from "./chord";

function makeContext(overrides: Partial<GlobalContext> = {}): GlobalContext {
  return {
    isInputCaptured: false,
    onSetView: vi.fn(),
    onToggleHotkeys: vi.fn(),
    onToggleFullscreen: vi.fn(),
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
  it.each([
    { code: "KeyM", view: "mindmap" },
    { code: "KeyL", view: "list" },
    { code: "KeyP", view: "plan" },
  ])("when Ctrl+$code is pressed, shows the $view view", ({ code, view }) => {
    const ctx = makeContext();
    expect(runFor(code, { ctrlKey: true }, ctx)).toBe(true);
    expect(ctx.onSetView).toHaveBeenCalledWith(view);
  });

  it("names each view outright, so no chord depends on which view you are on", () => {
    const setters = GLOBAL_BINDINGS.filter((b) => b.id.startsWith("global.view"));
    expect(setters.map((b) => b.id)).toEqual(["global.viewMindmap", "global.viewList", "global.viewPlan"]);
  });

  // The whole reason the switcher is on Ctrl. Alt+A/P/S/D/B are the status presets, in every
  // view's own table, and a global binding on one of those letters would fire alongside the preset
  // rather than instead of it: two tables, two listeners, and preventDefault on the first does not
  // reach the second.
  it.each(["KeyA", "KeyP", "KeyS", "KeyD", "KeyB"])("leaves Alt+%s to the status presets", (code) => {
    const ctx = makeContext();
    expect(runFor(code, { altKey: true }, ctx)).toBe(false);
    expect(ctx.onSetView).not.toHaveBeenCalled();
  });

  // Reserved for the Steps View (Arlesh-c1g), so the scheme is settled before that view lands.
  it("leaves Ctrl+S unbound, held for the Steps View", () => {
    const ctx = makeContext();
    expect(runFor("KeyS", { ctrlKey: true }, ctx)).toBe(false);
  });

  // Unlike quitting and the cheat-sheet, switching views behind an open modal would leave the
  // modal sitting over a board it no longer belongs to.
  it.each(["KeyM", "KeyL", "KeyP"])("does not switch views on Ctrl+%s while a modal holds the keyboard", (code) => {
    const ctx = makeContext({ isInputCaptured: true });
    expect(runFor(code, { ctrlKey: true }, ctx)).toBe(false);
    expect(ctx.onSetView).not.toHaveBeenCalled();
  });

  it("still quits and still toggles the cheat-sheet while a modal holds the keyboard", () => {
    const ctx = makeContext({ isInputCaptured: true });
    expect(runFor("KeyQ", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
  });

  it("when Ctrl+Shift+/ is pressed, toggles the cheat-sheet", () => {
    const ctx = makeContext();
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleHotkeys).toHaveBeenCalledTimes(1);
  });

  // Carrying no guard, the same chord is what shuts the sheet again — and it stays reachable
  // whatever the Mindmap has selected, which is the whole reason the recursive expand went
  // elsewhere rather than sharing this chord.
  it("when Ctrl+Shift+/ is pressed a second time, toggles the cheat-sheet shut", () => {
    const ctx = makeContext();
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleHotkeys).toHaveBeenCalledTimes(2);
  });

  it("when Ctrl+Alt+/ is pressed, matches nothing global — the Mindmap owns that chord", () => {
    const ctx = makeContext();
    expect(runFor("Slash", { ctrlKey: true, altKey: true }, ctx)).toBe(false);
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

  it("when Ctrl+Shift+L is pressed, matches nothing", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { ctrlKey: true, shiftKey: true }, ctx)).toBe(false);
  });

  // The one piece of muscle memory this costs, pinned so it is a deliberate change rather than
  // something that quietly comes back.
  it("no longer answers the old Alt+L toggle", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { altKey: true }, ctx)).toBe(false);
    expect(ctx.onSetView).not.toHaveBeenCalled();
  });

  it("every binding carries a label key in the hotkeys namespace", () => {
    for (const binding of GLOBAL_BINDINGS) {
      expect(binding.labelKey).not.toBe("");
      expect(binding.section).toBe("global");
    }
  });
});
