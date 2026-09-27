import { describe, expect, it } from "vitest";
import { canonicalYesNoPills, isYesNoDimension, modeFromModifiers, nextMode } from "./filter-modes";
import type { FilterDimension } from "./filter-modes";
import { withCurrentPillDimensions } from "./list-filter";

describe("modeFromModifiers", () => {
  it.each([
    { keys: { shiftKey: false, altKey: false }, mode: "all" },
    { keys: { shiftKey: true, altKey: false }, mode: "any" },
    { keys: { shiftKey: false, altKey: true }, mode: "exclude" },
    { keys: { shiftKey: true, altKey: true }, mode: "exclude" },
  ])("with shift=$keys.shiftKey alt=$keys.altKey adds as $mode", ({ keys, mode }) => {
    expect(modeFromModifiers(keys)).toBe(mode);
  });
});

describe("nextMode", () => {
  it("cycles All → Any → Not → All, flags included", () => {
    expect(nextMode("all")).toBe("any");
    expect(nextMode("any")).toBe("exclude");
    expect(nextMode("exclude")).toBe("all");
  });
});

describe("isYesNoDimension", () => {
  it("names Blocked, Agentic, Asynchronous and Private only", () => {
    const dimensions: FilterDimension[] = ["blocked", "agentic", "asynchronous", "private", "tag", "verdict"];
    expect(dimensions.map(isYesNoDimension)).toEqual([true, true, true, true, false, false]);
  });
});

describe("canonicalYesNoPills", () => {
  it.each([
    { pill: { value: "blocked", mode: "any" as const }, mode: "any" },
    { pill: { value: "blocked", mode: "all" as const }, mode: "all" },
    { pill: { value: "blocked", mode: "exclude" as const }, mode: "exclude" },
    { pill: { value: "not_blocked", mode: "all" as const }, mode: "exclude" },
    { pill: { value: "not_blocked", mode: "exclude" as const }, mode: "all" },
  ])("reads $pill.value in $pill.mode as the one pill in $mode", ({ pill, mode }) => {
    expect(canonicalYesNoPills("blocked", [pill])).toEqual([{ value: "blocked", mode }]);
  });

  it("keeps the first pill's question when two disagreed", () => {
    expect(canonicalYesNoPills("agentic", [
      { value: "agentic", mode: "all" }, { value: "not_agentic", mode: "all" },
    ])).toEqual([{ value: "agentic", mode: "all" }]);
  });

  it("brings persisted state to the one-pill shape on load", () => {
    const loaded = withCurrentPillDimensions({
      preset: "all",
      pills: {
        blocked: [{ value: "not_blocked", mode: "any" }],
        agentic: [{ value: "agentic", mode: "any" }],
        taskStatus: [{ value: "todo", mode: "any" }],
      },
    });
    expect(loaded.pills.blocked).toEqual([{ value: "blocked", mode: "exclude" }]);
    expect(loaded.pills.agentic).toEqual([{ value: "agentic", mode: "any" }]);
    expect(loaded.pills.taskStatus).toEqual([{ value: "todo", mode: "any" }]);
  });
});
