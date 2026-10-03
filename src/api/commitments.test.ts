import { describe, it, expect } from "vitest";
import { isVerdict } from "./verdict";

describe("isVerdict", () => {
  it("accepts the three verdicts and nothing else", () => {
    for (const verdict of ["unresolved", "kept", "broken"]) {
      expect(isVerdict(verdict)).toBe(true);
    }
    // A Task's and a Goal's words for resolution are not verdicts in disguise.
    for (const other of ["done", "achieved", "todo", ""]) {
      expect(isVerdict(other)).toBe(false);
    }
  });
});
