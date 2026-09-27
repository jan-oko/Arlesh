import { describe, expect, it } from "vitest";
import { searchFilterCatalogue, switchStateAfterPick } from "./filter-search";
import type { SearchGroup, ValueResult } from "./filter-search";

function value(dimension: ValueResult["dimension"], label: string, matchText = label): ValueResult {
  return { kind: "value", dimension, value: label.toLowerCase(), label, color: null, detail: null, matchText };
}

const GROUPS: SearchGroup[] = [
  { key: "antecedent", label: "Under", aliases: ["Antecedent"], searchOnly: true, results: [value("antecedent", "ARLESH"), value("antecedent", "Growth")] },
  { key: "tag", label: "Tags", aliases: [], searchOnly: false, results: [value("tag", "urgent"), value("tag", "home")] },
  { key: "yesNo", label: "Yes / no", aliases: [], searchOnly: false, results: [value("blocked", "Blocked", "Blocked Not blocked")] },
  {
    key: "switches", label: "Switches", aliases: [], searchOnly: false,
    results: [{ kind: "switch", target: "archived", label: "Archived", state: "inactive", matchText: "Archived" }],
  },
];

describe("searchFilterCatalogue", () => {
  it("lists nothing until something is typed", () => {
    expect(searchFilterCatalogue(GROUPS, "")).toEqual([]);
    expect(searchFilterCatalogue(GROUPS, "   ")).toEqual([]);
  });

  it("narrows by a value's text, dropping headings left empty", () => {
    const sections = searchFilterCatalogue(GROUPS, "urg");
    expect(sections.map((s) => s.results.map((r) => r.label))).toEqual([["urgent"]]);
  });

  it("finds a node by its name, under its node heading", () => {
    const sections = searchFilterCatalogue(GROUPS, "arl");
    expect(sections.map((s) => [s.label, s.searchOnly, s.results.map((r) => r.label)])).toEqual([["Under", true, ["ARLESH"]]]);
  });

  it("keeps a whole heading when its old name matches", () => {
    const sections = searchFilterCatalogue(GROUPS, "antecedent");
    expect(sections.map((s) => s.results.map((r) => r.label))).toEqual([["ARLESH", "Growth"]]);
  });

  it("finds a yes/no pill by its Not wording", () => {
    const sections = searchFilterCatalogue(GROUPS, "not blocked");
    expect(sections.map((s) => s.label)).toEqual(["Yes / no"]);
  });

  it("finds a switch by name", () => {
    expect(searchFilterCatalogue(GROUPS, "arch").flatMap((s) => s.results.map((r) => r.label))).toEqual(["Archived"]);
  });

  it("answers an unmatched query with nothing", () => {
    expect(searchFilterCatalogue(GROUPS, "zzz")).toEqual([]);
  });
});

describe("switchStateAfterPick", () => {
  const plain = { shiftKey: false, altKey: false };
  const shift = { shiftKey: true, altKey: false };
  const alt = { shiftKey: false, altKey: true };

  it("includes on a plain pick and on Shift, excludes on Alt", () => {
    expect(switchStateAfterPick("inactive", plain)).toBe("include");
    expect(switchStateAfterPick("inactive", shift)).toBe("include");
    expect(switchStateAfterPick("include", alt)).toBe("exclude");
  });

  it("clears back to the preset when the state picked is the one already set", () => {
    expect(switchStateAfterPick("include", plain)).toBe("inactive");
    expect(switchStateAfterPick("exclude", alt)).toBe("inactive");
  });
});
