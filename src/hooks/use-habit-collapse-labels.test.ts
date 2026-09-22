import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import "@/i18n";
import { useHabitCollapseLabels } from "@/hooks/use-habit-collapse-labels";

function labels() {
  return renderHook(() => useHabitCollapseLabels()).result.current;
}

describe("useHabitCollapseLabels", () => {
  it("names the Habit ahead of the run's tally", () => {
    expect(labels().run("Journal", { passed: 14, done: 9, missed: 5 }))
      .toBe("Journal: 14 passed · 9 done, 5 missed");
  });

  // Interpolated, not concatenated: the title has to be a placeholder the key can move, since a
  // translation may well want it somewhere other than the front.
  it("interpolates the Habit's title rather than pasting it on", () => {
    expect(labels().run("Journal & Reflect", { passed: 2, done: 2, missed: 0 }))
      .toContain("Journal & Reflect");
  });

  it("leaves a scope level reading its unit and tally, with no Habit title to repeat", () => {
    expect(labels().level("September", { passed: 30, done: 18, missed: 12 }))
      .toBe("September · 18 done, 12 missed");
  });
});
