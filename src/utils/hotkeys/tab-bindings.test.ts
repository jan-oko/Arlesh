import { describe, it, expect, vi } from "vitest";
import { TAB_BINDINGS } from "./tab-bindings";
import type { TabContext } from "./tab-bindings";
import { matchesChord } from "./chord";

function makeContext(overrides: Partial<TabContext> = {}): TabContext {
  return {
    isInputCaptured: false,
    onOpenTab: vi.fn(),
    onOpenWindow: vi.fn(),
    onCloseTab: vi.fn(),
    onTearOffTab: vi.fn(),
    onNextTab: vi.fn(),
    onPreviousTab: vi.fn(),
    onJumpToTab: vi.fn(),
    ...overrides,
  };
}

/** Dispatches as the app does: the first binding whose chord matches and whose guard passes. */
function runFor(code: string, modifiers: Partial<KeyboardEventInit>, ctx: TabContext): boolean {
  const event = new KeyboardEvent("keydown", { code, ...modifiers });
  const binding = TAB_BINDINGS.find(
    (b) => matchesChord(event, b.chord) && (b.when === undefined || b.when(ctx)),
  );
  if (binding === undefined) return false;
  binding.run(ctx);
  return true;
}

describe("the tab and window chords", () => {
  it("opens a tab on Ctrl+T and a window on Ctrl+N", () => {
    const ctx = makeContext();

    expect(runFor("KeyT", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("KeyN", { ctrlKey: true }, ctx)).toBe(true);

    expect(ctx.onOpenTab).toHaveBeenCalledOnce();
    expect(ctx.onOpenWindow).toHaveBeenCalledOnce();
  });

  it("tears the tab off on Ctrl+Alt+N, which Ctrl+N alone does not do", () => {
    const ctx = makeContext();

    expect(runFor("KeyN", { ctrlKey: true, altKey: true }, ctx)).toBe(true);

    expect(ctx.onTearOffTab).toHaveBeenCalledOnce();
    // Strict chord matching keeps the two apart: Ctrl+N requires Alt to be up.
    expect(ctx.onOpenWindow).not.toHaveBeenCalled();
  });

  it("keeps opening, closing and switching live behind a modal", () => {
    const ctx = makeContext({ isInputCaptured: true });

    expect(runFor("KeyT", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("KeyN", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("KeyW", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("Tab", { ctrlKey: true }, ctx)).toBe(true);
    expect(runFor("Digit3", { ctrlKey: true }, ctx)).toBe(true);
  });

  it("does not tear a tab off from under an open modal or inline editor", () => {
    // The tear-off carries the tab's *persisted* state, and a modal's contents are not part of it,
    // so this would silently drop whatever is being typed. Closing loses it too, but a close is a
    // gesture that says "throw this away".
    const ctx = makeContext({ isInputCaptured: true });

    expect(runFor("KeyN", { ctrlKey: true, altKey: true }, ctx)).toBe(false);
    expect(ctx.onTearOffTab).not.toHaveBeenCalled();
  });

  it("guards the tear-off and nothing else, so a new guard here has to be deliberate", () => {
    const guarded = TAB_BINDINGS.filter((b) => b.when !== undefined).map((b) => b.id);
    expect(guarded).toEqual(["tabs.tearOff"]);
  });
});
