import { describe, it, expect } from "vitest";
import { commitmentGlyphState, COMMITMENT_GLYPH } from "@/utils/commitment-glyph";
import { VERDICT } from "@/api/commitments";

describe("commitmentGlyphState", () => {
  it("draws a commitment nobody has judged yet as live", () => {
    expect(commitmentGlyphState(VERDICT.UNRESOLVED, false)).toBe(COMMITMENT_GLYPH.LIVE);
  });

  it("draws a commitment whose Verdict Window ran out unanswered as expired", () => {
    expect(commitmentGlyphState(VERDICT.UNRESOLVED, true)).toBe(COMMITMENT_GLYPH.EXPIRED);
  });

  it("keeps a judged commitment's verdict once its window has closed", () => {
    // Archived here means "settled", not "you never said" — the record of having kept or broken
    // something must not decay into the unanswered glyph.
    expect(commitmentGlyphState(VERDICT.KEPT, true)).toBe(COMMITMENT_GLYPH.KEPT);
    expect(commitmentGlyphState(VERDICT.BROKEN, true)).toBe(COMMITMENT_GLYPH.BROKEN);
  });

  it("draws a verdict recorded inside the window as that verdict", () => {
    expect(commitmentGlyphState(VERDICT.KEPT, false)).toBe(COMMITMENT_GLYPH.KEPT);
    expect(commitmentGlyphState(VERDICT.BROKEN, false)).toBe(COMMITMENT_GLYPH.BROKEN);
  });

  it("treats a missing verdict as unresolved rather than as a fifth state", () => {
    expect(commitmentGlyphState(undefined, false)).toBe(COMMITMENT_GLYPH.LIVE);
    expect(commitmentGlyphState(undefined, true)).toBe(COMMITMENT_GLYPH.EXPIRED);
  });
});
