import { describe, it, expect } from "vitest";
import { matchesChord, formatChord } from "./chord";

function keyEvent(code: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, ...modifiers });
}

describe("matchesChord", () => {
  it("when the code differs, does not match", () => {
    expect(matchesChord(keyEvent("KeyA"), { code: "KeyB" })).toBe(false);
  });

  it("when the code matches and no modifiers are held, matches a bare chord", () => {
    expect(matchesChord(keyEvent("KeyE"), { code: "KeyE" })).toBe(true);
  });

  it("when an unspecified modifier is held, does not match", () => {
    expect(matchesChord(keyEvent("KeyE", { ctrlKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { shiftKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { altKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { metaKey: true }), { code: "KeyE" })).toBe(false);
  });

  it("when a required modifier is absent, does not match", () => {
    expect(matchesChord(keyEvent("KeyO"), { code: "KeyO", ctrl: true })).toBe(false);
  });

  it("when exactly the required modifiers are held, matches", () => {
    expect(matchesChord(keyEvent("KeyO", { ctrlKey: true }), { code: "KeyO", ctrl: true })).toBe(true);
    expect(
      matchesChord(keyEvent("Slash", { ctrlKey: true, shiftKey: true }), { code: "Slash", ctrl: true, shift: true }),
    ).toBe(true);
  });

  it("when Ctrl+Shift+/ is pressed, does not match the bare Ctrl+/ chord", () => {
    expect(matchesChord(keyEvent("Slash", { ctrlKey: true, shiftKey: true }), { code: "Slash", ctrl: true })).toBe(false);
  });
});

describe("formatChord", () => {
  it("when the chord is Ctrl+Shift+Slash, renders it as Ctrl+Shift+/", () => {
    expect(formatChord({ code: "Slash", ctrl: true, shift: true })).toBe("Ctrl+Shift+/");
  });

  it("when the chord is a bare letter, renders just the letter", () => {
    expect(formatChord({ code: "KeyE" })).toBe("E");
  });

  it("when the chord is an arrow or a named key, renders a readable name", () => {
    expect(formatChord({ code: "ArrowUp" })).toBe("↑");
    expect(formatChord({ code: "Escape" })).toBe("Esc");
    expect(formatChord({ code: "Equal", ctrl: true })).toBe("Ctrl+=");
  });
});
