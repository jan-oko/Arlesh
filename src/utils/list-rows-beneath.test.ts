import { describe, expect, it } from "vitest";
import { hasRowsBeneath, type EnterableRow } from "./list-rows-beneath";
import { makeFixtureTask } from "@/test/keyboard-context";

describe("hasRowsBeneath", () => {
  const parent = makeFixtureTask("parent");
  const rows: EnterableRow[] = [
    { node: parent, ancestors: [] },
    { node: makeFixtureTask("leaf"), ancestors: [parent] },
  ];

  it("is true for a row that has rows beneath it", () => {
    expect(hasRowsBeneath("parent", rows)).toBe(true);
  });

  it("is false for a leaf", () => {
    expect(hasRowsBeneath("leaf", rows)).toBe(false);
  });
});
