import { describe, expect, it } from "vitest";
import { filterMenuRows, filterSwitchesFor, rowDimensions } from "./filter-layout";

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
});

describe("rowDimensions", () => {
  it("expands the Yes / no row into its three dimensions", () => {
    expect(rowDimensions("yesNo")).toEqual(["blocked", "agentic", "asynchronous"]);
    expect(rowDimensions("verdict")).toEqual(["verdict"]);
  });
});

describe("filterSwitchesFor", () => {
  it("offers Private, Archived and Backlog, leaving Backlog out of the Plan View, which answers it itself", () => {
    expect(filterSwitchesFor("list")).toEqual(["private", "archived", "backlog"]);
    expect(filterSwitchesFor("plan")).toEqual(["private", "archived"]);
  });
});
