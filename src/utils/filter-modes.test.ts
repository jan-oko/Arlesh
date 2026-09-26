import { describe, expect, it } from "vitest";
import { addedMode, canonicalYesNoPills, isYesNoDimension, modeFromModifiers, nextMode } from "./filter-modes";
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

describe("addedMode", () => {
  it("keeps Any for a dimension with many values", () => {
    expect(addedMode("tag", "any")).toBe("any");
  });

  it("stores a yes/no pill added with Shift as All: a row answers one of the two, so Any says nothing more", () => {
    expect(addedMode("blocked", "any")).toBe("all");
    expect(addedMode("agentic", "exclude")).toBe("exclude");
  });
});

describe("nextMode", () => {
  it("cycles All → Any → Not → All", () => {
    expect(nextMode("taskStatus", "all")).toBe("any");
    expect(nextMode("taskStatus", "any")).toBe("exclude");
    expect(nextMode("taskStatus", "exclude")).toBe("all");
  });

  it("flips a yes/no pill between is and is-not", () => {
    expect(nextMode("asynchronous", "all")).toBe("exclude");
    expect(nextMode("asynchronous", "exclude")).toBe("all");
  });
});

describe("isYesNoDimension", () => {
  it("names Blocked, Agentic and Asynchronous only", () => {
    const dimensions: FilterDimension[] = ["blocked", "agentic", "asynchronous", "tag", "verdict"];
    expect(dimensions.map(isYesNoDimension)).toEqual([true, true, true, false, false]);
  });
});

describe("canonicalYesNoPills", () => {
  it.each([
    { pill: { value: "blocked", mode: "any" as const }, mode: "all" },
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
      pills: { blocked: [{ value: "not_blocked", mode: "any" }], taskStatus: [{ value: "todo", mode: "any" }] },
    });
    expect(loaded.pills.blocked).toEqual([{ value: "blocked", mode: "exclude" }]);
    expect(loaded.pills.taskStatus).toEqual([{ value: "todo", mode: "any" }]);
  });
});
