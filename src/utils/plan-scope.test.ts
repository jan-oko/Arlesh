import { describe, it, expect } from "vitest";
import { cursorAtNow, cursorFromRef, cursorRef, isPlanScopeKind, parentRefs, partOfHour, stepCursor } from "./plan-scope";
import type { PlanScopeCursor } from "./plan-scope";

const WEEK: PlanScopeCursor = { kind: "week", date: "2026-09-20", part: "morning" };

describe("isPlanScopeKind", () => {
  it("accepts the five fillable kinds and refuses an exact window", () => {
    for (const kind of ["season", "month", "week", "day", "part_of_day"]) {
      expect(isPlanScopeKind(kind)).toBe(true);
    }
    expect(isPlanScopeKind("exact")).toBe(false);
  });
});

describe("cursorRef", () => {
  it("names a canonical cell by its date alone", () => {
    expect(cursorRef(WEEK)).toEqual({ kind: "week", date: "2026-09-20" });
  });

  it("carries the band for a part-of-day cell", () => {
    expect(cursorRef({ ...WEEK, kind: "part_of_day" })).toEqual({
      kind: "part_of_day", date: "2026-09-20", part: "morning",
    });
  });
});

describe("stepCursor", () => {
  it("moves a week cursor seven days", () => {
    expect(stepCursor(WEEK, 1).date).toBe("2026-09-27");
    expect(stepCursor(WEEK, -1).date).toBe("2026-09-13");
  });

  it("moves a month cursor a whole month from the month's first day", () => {
    const month: PlanScopeCursor = { kind: "month", date: "2026-09-01", part: "morning" };
    expect(stepCursor(month, 1).date).toBe("2026-10-01");
  });

  it("moves a season cursor three months", () => {
    const season: PlanScopeCursor = { kind: "season", date: "2026-09-01", part: "morning" };
    expect(stepCursor(season, 1).date).toBe("2026-12-01");
  });

  it("walks the bands of one day without moving the date", () => {
    const part: PlanScopeCursor = { kind: "part_of_day", date: "2026-09-20", part: "noon" };
    expect(stepCursor(part, 1)).toEqual({ kind: "part_of_day", date: "2026-09-20", part: "afternoon" });
  });

  it("rolls into the next day past the last band", () => {
    const night: PlanScopeCursor = { kind: "part_of_day", date: "2026-09-20", part: "night" };
    expect(stepCursor(night, 1)).toEqual({ kind: "part_of_day", date: "2026-09-21", part: "premorning" });
  });

  it("rolls into the previous day before the first band", () => {
    const first: PlanScopeCursor = { kind: "part_of_day", date: "2026-09-20", part: "premorning" };
    expect(stepCursor(first, -1)).toEqual({ kind: "part_of_day", date: "2026-09-19", part: "night" });
  });
});

describe("cursorFromRef", () => {
  it("keeps the band a canonical pick cannot supply", () => {
    expect(cursorFromRef({ kind: "day", date: "2026-09-22" }, "evening")).toEqual({
      kind: "day", date: "2026-09-22", part: "evening",
    });
  });

  it("fills nothing from an exact window", () => {
    expect(cursorFromRef({ kind: "exact", start: "a", end: "b" }, "evening")).toBeNull();
  });
});

describe("partOfHour", () => {
  it.each([
    [0, "night"], [1, "night"], [4, "premorning"], [6, "morning"], [13, "noon"],
    [17, "afternoon"], [21, "evening"], [22, "night"],
  ])("puts hour %i in %s", (hour, part) => {
    expect(partOfHour(hour)).toBe(part);
  });
});

describe("cursorAtNow", () => {
  it("opens on today's scope of the remembered kind", () => {
    expect(cursorAtNow("week", "2026-09-22", 10)).toEqual({
      kind: "week", date: "2026-09-22", part: "morning",
    });
  });

  it("puts the small hours in the previous day's Night, as the backend's bands do", () => {
    expect(cursorAtNow("part_of_day", "2026-09-22", 1)).toEqual({
      kind: "part_of_day", date: "2026-09-21", part: "night",
    });
  });
});

describe("parentRefs", () => {
  it("is the day a part of day sits in", () => {
    expect(parentRefs({ kind: "part_of_day", start_date: "2026-09-22", end_date: "2026-09-23" }))
      .toEqual([{ kind: "day", date: "2026-09-22" }]);
  });

  it("is the week a day sits in", () => {
    expect(parentRefs({ kind: "day", start_date: "2026-09-22", end_date: "2026-09-22" }))
      .toEqual([{ kind: "week", date: "2026-09-22" }]);
  });

  it("is the one month a week wholly inside it sits in", () => {
    expect(parentRefs({ kind: "week", start_date: "2026-09-20", end_date: "2026-09-26" }))
      .toEqual([{ kind: "month", date: "2026-09-20" }]);
  });

  it("is both months for a week at a month's edge", () => {
    expect(parentRefs({ kind: "week", start_date: "2026-09-27", end_date: "2026-10-03" }))
      .toEqual([{ kind: "month", date: "2026-09-27" }, { kind: "month", date: "2026-10-03" }]);
  });

  it("is the season a month sits in", () => {
    expect(parentRefs({ kind: "month", start_date: "2026-09-01", end_date: "2026-09-30" }))
      .toEqual([{ kind: "season", date: "2026-09-01" }]);
  });

  it("is nothing for a Season, the top of the ladder", () => {
    expect(parentRefs({ kind: "season", start_date: "2026-09-01", end_date: "2026-11-30" })).toEqual([]);
  });
});
