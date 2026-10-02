import { describe, it, expect } from "vitest";
import { blockedByText } from "./blocked-by";

describe("blockedByText", () => {
  it("names the target by its short id", () => {
    expect(blockedByText("task", "6f3", 245, "Write spec")).toBe("Blocked by task 6f3 (Write spec)");
  });

  it("falls back to the row id while the target has no short id", () => {
    expect(blockedByText("goal", undefined, 9, "Milestone")).toBe("Blocked by goal 9 (Milestone)");
  });
});
