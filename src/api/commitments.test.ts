import { describe, it, expect } from "vitest";
import { NEXT_VERDICT, VERDICT, isVerdict, verdictAfterPressing } from "./commitments";

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
    // One press of the cross on a kept commitment records Broken. The controls are two explicit,
    // equal choices; neither of them cycles, whatever Enter does.
    expect(verdictAfterPressing(VERDICT.BROKEN, VERDICT.KEPT)).toBe(VERDICT.BROKEN);
    expect(verdictAfterPressing(VERDICT.KEPT, VERDICT.BROKEN)).toBe(VERDICT.KEPT);
  });
});

describe("NEXT_VERDICT", () => {
  it("walks Unresolved \u2192 Kept \u2192 Broken \u2192 Unresolved", () => {
    expect(NEXT_VERDICT[VERDICT.UNRESOLVED]).toBe(VERDICT.KEPT);
    expect(NEXT_VERDICT[VERDICT.KEPT]).toBe(VERDICT.BROKEN);
    expect(NEXT_VERDICT[VERDICT.BROKEN]).toBe(VERDICT.UNRESOLVED);
  });

  it("returns to where it started after three steps, from any verdict", () => {
    for (const start of [VERDICT.UNRESOLVED, VERDICT.KEPT, VERDICT.BROKEN]) {
      expect(NEXT_VERDICT[NEXT_VERDICT[NEXT_VERDICT[start]]]).toBe(start);
    }
  });
});
