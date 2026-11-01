import { describe, expect, it } from "vitest";
import { listEnterTarget, type EnterableRow } from "./list-enter";
import { makeFixtureTask } from "@/test/keyboard-context";

const node = makeFixtureTask;

describe("listEnterTarget", () => {
  const parent = node("parent");
  const rows: EnterableRow[] = [
    { node: parent, ancestors: [] },
    { node: node("leaf"), ancestors: [parent] },
  ];

  it("enters a row that has rows beneath it as itself", () => {
    expect(listEnterTarget("parent", rows)).toBe("parent");
  });

  it("enters a leaf through its parent, which keeps it on screen", () => {
    expect(listEnterTarget("leaf", rows)).toBe("parent");
  });

  it("enters a leaf with no parent as itself", () => {
    expect(listEnterTarget("lone", [{ node: node("lone"), ancestors: [] }])).toBe("lone");
  });
});
