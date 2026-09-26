import { describe, it, expect } from "vitest";
import { takeOutTarget } from "./plan-take-out";

describe("takeOutTarget", () => {
  it("plans work taken out of a bucket to the scope being filled itself", () => {
    expect(takeOutTarget(true, "week 39", "September")).toEqual({ kind: "plan", scope: "week 39" });
  });

  it("plans work taken out of an unsplit scope to its parent", () => {
    expect(takeOutTarget(false, "week 39", "September")).toEqual({ kind: "plan", scope: "September" });
  });

  it("clears the Plan of work taken out of an unsplit Season, which has no parent", () => {
    expect(takeOutTarget(false, "Autumn", null)).toEqual({ kind: "clear" });
  });

  it("plans work taken out of a Season's month bucket to the Season, parent or none", () => {
    expect(takeOutTarget(true, "Autumn", null)).toEqual({ kind: "plan", scope: "Autumn" });
  });
});
