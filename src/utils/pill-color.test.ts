import { describe, it, expect } from "vitest";
import { modeColorVar, tintBackground } from "./pill-color";

describe("modeColorVar", () => {
  it("maps each mode to a distinct CSS variable", () => {
    expect(modeColorVar("any")).toBe("var(--mode-any)");
    expect(modeColorVar("all")).toBe("var(--mode-all)");
    expect(modeColorVar("exclude")).toBe("var(--mode-exclude)");
  });
});

describe("tintBackground", () => {
  it("adds an alpha suffix to a #rrggbb color", () => {
    expect(tintBackground("#7c7cff")).toBe("#7c7cff22");
  });

  it("returns undefined for null/undefined/non-hex input", () => {
    expect(tintBackground(null)).toBeUndefined();
    expect(tintBackground(undefined)).toBeUndefined();
    expect(tintBackground("var(--accent)")).toBeUndefined();
  });
});
