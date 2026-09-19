import { describe, it, expect } from "vitest";
import { VERDICT, isVerdict, verdictAfterPressing } from "./commitments";

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

describe("verdictAfterPressing", () => {
  it("records the verdict the control stands for", () => {
    expect(verdictAfterPressing(VERDICT.KEPT, VERDICT.UNRESOLVED)).toBe(VERDICT.KEPT);
    expect(verdictAfterPressing(VERDICT.BROKEN, VERDICT.UNRESOLVED)).toBe(VERDICT.BROKEN);
  });

  it("clears the verdict when the control that already reads it is pressed again", () => {
    expect(verdictAfterPressing(VERDICT.KEPT, VERDICT.KEPT)).toBe(VERDICT.UNRESOLVED);
    expect(verdictAfterPressing(VERDICT.BROKEN, VERDICT.BROKEN)).toBe(VERDICT.UNRESOLVED);
  });

  it("never passes through Unresolved on the way between the two verdicts", () => {
    // One press of the cross on a kept commitment records Broken. Two explicit controls, not one
    // cycle, is what keeps Broken from being a stray keystroke past Kept.
    expect(verdictAfterPressing(VERDICT.BROKEN, VERDICT.KEPT)).toBe(VERDICT.BROKEN);
    expect(verdictAfterPressing(VERDICT.KEPT, VERDICT.BROKEN)).toBe(VERDICT.KEPT);
  });
});
