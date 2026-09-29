import { describe, it, expect } from "vitest";
import { lockedStatusMode } from "./view-preset";

describe("lockedStatusMode", () => {
  it("locks the Plan View to Plan and the Zen View to Do", () => {
    expect(lockedStatusMode("plan")).toBe("plan");
    expect(lockedStatusMode("zen")).toBe("do");
  });

  it.each(["mindmap", "list", "steps"] as const)("leaves the %s view on the tab's own preset", (view) => {
    expect(lockedStatusMode(view)).toBeNull();
  });
});
