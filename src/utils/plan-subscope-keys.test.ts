import { describe, it, expect } from "vitest";
import { assignSubscopeKeys } from "./plan-subscope-keys";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PARTS = ["Premorning", "Morning", "Noon", "Afternoon", "Evening", "Night"];

describe("assignSubscopeKeys", () => {
  it("numbers the buckets by their position in the pane", () => {
    expect(assignSubscopeKeys(["W38", "W39", "W40"]).map((keys) => keys.digit)).toEqual([1, 2, 3]);
  });

  it("gives the days of a week the initials that name one day and no other", () => {
    const letters = assignSubscopeKeys(WEEKDAYS).map((keys) => keys.letter);
    // T is Tuesday's and Thursday's; S is Sunday's and Saturday's; F is spent on "show the board
    // alone". Monday and Wednesday are left.
    expect(letters).toEqual([null, "M", null, "W", null, null, null]);
  });

  it("gives the parts of a day the same treatment", () => {
    const letters = assignSubscopeKeys(PARTS).map((keys) => keys.letter);
    // N is Noon's and Night's; E is spent on the editor.
    expect(letters).toEqual(["P", "M", null, "A", null, null]);
  });

  it("never gives a week number a letter, because every week starts with the same one", () => {
    const letters = assignSubscopeKeys(["W38", "W39", "W40", "W41"]).map((keys) => keys.letter);
    expect(letters).toEqual([null, null, null, null]);
  });

  it("gives a season's three months their own initials where they differ", () => {
    expect(assignSubscopeKeys(["September", "October", "November"]).map((k) => k.letter))
      .toEqual(["S", "O", "N"]);
    // March and May collide; April stands alone.
    expect(assignSubscopeKeys(["March", "April", "May"]).map((k) => k.letter))
      .toEqual([null, "A", null]);
  });

  it("leaves a label that opens with no letter to its number", () => {
    expect(assignSubscopeKeys(["2026-09-20"])).toEqual([{ digit: 1, letter: null }]);
  });
});
