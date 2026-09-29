import { describe, expect, it } from "vitest";
import { filterMenuRows, filterSwitchesFor, flagsFor, offeredDimensions, rowDimensions, rowKindsFor } from "./filter-layout";

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
  it("offers Private, Archived and Backlog, leaving Backlog out of the Plan View, which answers it itself", () => {
    expect(filterSwitchesFor("list")).toEqual(["private", "archived", "backlog"]);
    expect(filterSwitchesFor("plan")).toEqual(["private", "archived"]);
  });
});
