import { describe, expect, it } from "vitest";
import type { FilterDotState } from "./filter-layout";
import { chipDimensions, filterMenuRows, filterSwitchesFor, hasUndrawnFilters, undrawnPillDimensions, flagsFor, offeredDimensions, rowDimensions, rowKindsFor } from "./filter-layout";

describe("filterMenuRows", () => {
  it("lists the List View's rows grouped: Under, Tags, Depends on | Scope, Yes / no | Task, Goal, Project, Verdict", () => {
    expect(filterMenuRows("list")).toEqual([
      ["antecedent", "tag", "dependency"],
      ["scopeState", "yesNo"],
      ["taskStatus", "goalStatus", "projectStatus", "verdict"],
    ]);
  });

  it.each(["mindmap", "steps", "plan"] as const)("gives the %s view Tags alone", (view) => {
    expect(filterMenuRows(view)).toEqual([["tag"]]);
  });

  it("gives the Zen View Tags, then Agentic", () => {
    expect(filterMenuRows("zen")).toEqual([["tag"], ["agentic"]]);
  });
});

describe("rowKindsFor and flagsFor", () => {
  it("switch the List View's three kinds and every flag, the Zen View's two strips and Agentic, and nothing elsewhere", () => {
    expect(rowKindsFor("list")).toEqual(["task", "commitment", "expectation"]);
    expect(flagsFor("list")).toEqual(["blocked", "agentic", "asynchronous", "private"]);
    expect(rowKindsFor("zen")).toEqual(["commitment", "expectation"]);
    expect(flagsFor("zen")).toEqual(["agentic"]);
    for (const view of ["mindmap", "plan", "steps"] as const) {
      expect(rowKindsFor(view)).toEqual([]);
      expect(flagsFor(view)).toEqual([]);
    }
  });
});

describe("rowDimensions", () => {
  it("expands the Yes / no row into its dimensions", () => {
    expect(rowDimensions("yesNo")).toEqual(["blocked", "agentic", "asynchronous", "private"]);
    expect(rowDimensions("verdict")).toEqual(["verdict"]);
  });
});

describe("offeredDimensions", () => {
  it("offers the Private pill only while Private Mode is on", () => {
    expect(offeredDimensions("yesNo", false)).toEqual(["blocked", "agentic", "asynchronous"]);
    expect(offeredDimensions("yesNo", true)).toEqual(["blocked", "agentic", "asynchronous", "private"]);
  });
});

describe("filterSwitchesFor", () => {
  it("offers Private, Archived, Backlog and Delegated, leaving Backlog out of the Plan View, which answers it itself", () => {
    expect(filterSwitchesFor("list")).toEqual(["private", "archived", "backlog", "delegated"]);
    expect(filterSwitchesFor("plan")).toEqual(["private", "archived", "delegated"]);
  });
});

describe("undrawnPillDimensions", () => {
  it("is Agentic in the Zen View, and nothing in the List View or the tag-only views", () => {
    expect(undrawnPillDimensions("zen")).toEqual(["agentic"]);
    expect(undrawnPillDimensions("list")).toEqual([]);
    expect(undrawnPillDimensions("mindmap")).toEqual([]);
    expect(chipDimensions("zen")).toEqual(["tag"]);
  });
});

describe("hasUndrawnFilters", () => {
  const clean: FilterDotState = {
    archivedMode: "inactive", backlogMode: "inactive", delegatedMode: "inactive", showOnAgent: false, valueCount: () => 0,
  };

  it("lights for the On Agent pill wherever it is offered, and not in the Plan View", () => {
    const shown = { ...clean, showOnAgent: true };
    expect(hasUndrawnFilters("mindmap", shown)).toBe(true);
    expect(hasUndrawnFilters("list", shown)).toBe(true);
    expect(hasUndrawnFilters("zen", shown)).toBe(true);
    expect(hasUndrawnFilters("plan", shown)).toBe(false);
  });

  it("is false with everything at its default", () => {
    expect(hasUndrawnFilters("mindmap", clean)).toBe(false);
  });

  it("is true for Backlog off its default, except in the Plan View which does not offer it", () => {
    const backlog: FilterDotState = { ...clean, backlogMode: "exclude" };
    expect(hasUndrawnFilters("steps", backlog)).toBe(true);
    expect(hasUndrawnFilters("plan", backlog)).toBe(false);
  });

  it("is true for the Delegated pill off its default in every view, the Plan View included", () => {
    const delegated: FilterDotState = { ...clean, delegatedMode: "include" };
    expect(hasUndrawnFilters("mindmap", delegated)).toBe(true);
    expect(hasUndrawnFilters("plan", delegated)).toBe(true);
  });

  it("ignores tags, which are always chips", () => {
    const tagged: FilterDotState = { ...clean, valueCount: (d) => (d === "tag" ? 1 : 0) };
    expect(hasUndrawnFilters("zen", tagged)).toBe(false);
  });
});
