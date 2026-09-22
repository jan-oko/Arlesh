import { describe, it, expect } from "vitest";
import {
  descendKind,
  ascendKind,
  weekStart,
  seasonOf,
  weekNumber,
  seasonCells,
  monthCells,
  weekCells,
  dayCells,
  partCells,
  cellContainsDate,
  cellsForView,
  browseAnchor,
  viewHeader,
  addScopePeriods,
  partContaining,
  currentPartRef,
  currentDateIso,
  dayScopeDate,
  lastDayOfWindow,
  isCellCurrent,
  openingForRef,
  openingForRefs,
  openingForScopes,
} from "./scope-calendar";
import type { Scope } from "@/api/scopes";

describe("view navigation", () => {
  it("descends season → month → week → day → part → null", () => {
    expect(descendKind("season")).toBe("month");
    expect(descendKind("month")).toBe("week");
    expect(descendKind("week")).toBe("day");
    expect(descendKind("day")).toBe("part_of_day");
    expect(descendKind("part_of_day")).toBeNull();
  });

  it("ascends part → day → week → month → season → null", () => {
    expect(ascendKind("part_of_day")).toBe("day");
    expect(ascendKind("season")).toBeNull();
  });
});

describe("date helpers", () => {
  it("weekStart returns the Sunday of the week", () => {
    expect(weekStart("2026-06-20")).toBe("2026-06-14"); // Saturday → Sunday
    expect(weekStart("2026-06-17")).toBe("2026-06-14"); // Wednesday → same Sunday
    expect(weekStart("2026-06-14")).toBe("2026-06-14"); // Sunday → itself
  });

  it("seasonOf matches the Rust season model", () => {
    expect(seasonOf("2026-07-01")).toEqual({ name: "Summer", year: 2026 });
    expect(seasonOf("2026-12-01")).toEqual({ name: "Winter", year: 2026 });
    expect(seasonOf("2027-01-15")).toEqual({ name: "Winter", year: 2026 });
    expect(seasonOf("2026-10-01")).toEqual({ name: "Autumn", year: 2026 });
  });

  it("weekNumber is 1 for Jan 1 and in range mid-year", () => {
    expect(weekNumber("2026-01-01")).toBe(1);
    expect(weekNumber("2026-06-20")).toBeGreaterThanOrEqual(24);
    expect(weekNumber("2026-06-20")).toBeLessThanOrEqual(26);
  });
});

describe("seasonCells", () => {
  it("lists the four seasons beginning in the year with correct ranges", () => {
    const cells = seasonCells(2026);
    expect(cells.map((c) => c.label)).toEqual([
      "Spring 2026", "Summer 2026", "Autumn 2026", "Winter 2026",
    ]);
    expect(cells[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-05-31" });
    expect(cells[3]).toMatchObject({ startDate: "2026-12-01", endDate: "2027-02-28" });
  });
});

describe("monthCells", () => {
  it("lists twelve months with correct bounds", () => {
    const cells = monthCells(2026);
    expect(cells).toHaveLength(12);
    expect(cells[5]).toMatchObject({ label: "June 2026", startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(cells[11]).toMatchObject({ label: "December 2026", startDate: "2026-12-01", endDate: "2026-12-31" });
  });
});

describe("weekCells", () => {
  it("lists the Sunday-start weeks overlapping the month", () => {
    const cells = weekCells(2026, 6);
    expect(cells[0]?.startDate).toBe("2026-05-31");
    expect(cells[cells.length - 1]?.startDate).toBe("2026-06-28");
    expect(cells.every((c) => c.ref.kind === "week")).toBe(true);
  });
});

describe("dayCells", () => {
  it("lists the seven days of the week Sunday-first", () => {
    const cells = dayCells("2026-06-17");
    expect(cells.map((c) => c.startDate)).toEqual([
      "2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17",
      "2026-06-18", "2026-06-19", "2026-06-20",
    ]);
  });
});

describe("partCells", () => {
  it("lists six parts; Night ends on the following day", () => {
    const cells = partCells("2026-06-20");
    expect(cells).toHaveLength(6);
    const night = cells.find((c) => c.label === "Night");
    expect(night).toMatchObject({ startDate: "2026-06-20", endDate: "2026-06-21" });
  });
});

describe("cellContainsDate", () => {
  it("is true only within the inclusive range", () => {
    const [june] = monthCells(2026).slice(5);
    expect(june && cellContainsDate(june, "2026-06-15")).toBe(true);
    expect(june && cellContainsDate(june, "2026-07-01")).toBe(false);
  });
});

describe("cellsForView", () => {
  it("dispatches to the right enumerator by kind", () => {
    expect(cellsForView("season", "2026-06-20")).toHaveLength(4);
    expect(cellsForView("month", "2026-06-20")).toHaveLength(12);
    expect(cellsForView("day", "2026-06-20")).toHaveLength(7);
    expect(cellsForView("part_of_day", "2026-06-20")).toHaveLength(6);
  });
});

describe("browseAnchor", () => {
  it("shifts by the view's period", () => {
    expect(browseAnchor("month", "2026-06-20", 1)).toBe("2027-06-20");
    expect(browseAnchor("week", "2026-06-20", -1)).toBe("2026-05-20");
    expect(browseAnchor("day", "2026-06-20", 1)).toBe("2026-06-27");
    expect(browseAnchor("part_of_day", "2026-06-20", -1)).toBe("2026-06-19");
  });
});

describe("addScopePeriods", () => {
  it("advances by whole scopes of the kind (Duration snapshot)", () => {
    expect(addScopePeriods("month", "2026-06-01", 2)).toBe("2026-08-01");
    expect(addScopePeriods("week", "2026-06-14", 2)).toBe("2026-06-28");
    expect(addScopePeriods("season", "2026-03-01", 1)).toBe("2026-06-01");
    expect(addScopePeriods("day", "2026-06-20", 3)).toBe("2026-06-23");
  });

  it("a 3-week duration ends two weeks after the anchor", () => {
    // end boundary of "3 weeks" from W = anchor + (3 - 1) weeks
    expect(addScopePeriods("week", "2026-06-14", 3 - 1)).toBe("2026-06-28");
  });
});

describe("viewHeader", () => {
  it("labels the browsed period", () => {
    expect(viewHeader("season", "2026-06-20")).toBe("2026");
    expect(viewHeader("week", "2026-06-20")).toBe("June 2026");
    expect(viewHeader("part_of_day", "2026-06-20")).toBe("2026-06-20");
  });
});

describe("partContaining", () => {
  it("maps each band's hours to its part", () => {
    expect(partContaining(3)).toBe("premorning");
    expect(partContaining(6)).toBe("morning");
    expect(partContaining(12)).toBe("noon");
    expect(partContaining(15)).toBe("afternoon");
    expect(partContaining(18)).toBe("evening");
    expect(partContaining(22)).toBe("night");
  });

  it("puts the hours past midnight in Night", () => {
    expect(partContaining(0)).toBe("night");
    expect(partContaining(1)).toBe("night");
    expect(partContaining(2)).toBe("premorning");
  });
});

describe("currentPartRef", () => {
  it("names the part of the date the clock reads, during the day", () => {
    expect(currentPartRef(new Date("2026-06-15T10:00:00Z"))).toEqual({
      date: "2026-06-15",
      part: "morning",
    });
  });

  it("at 23:00 names that date's Night", () => {
    expect(currentPartRef(new Date("2026-06-15T23:00:00Z"))).toEqual({
      date: "2026-06-15",
      part: "night",
    });
  });

  it("at 00:30 names the previous date's Night (the wrap past midnight)", () => {
    expect(currentPartRef(new Date("2026-06-15T00:30:00Z"))).toEqual({
      date: "2026-06-14",
      part: "night",
    });
  });

  it("at 02:00 the wrap is over and Premorning belongs to the date the clock reads", () => {
    expect(currentPartRef(new Date("2026-06-15T02:00:00Z"))).toEqual({
      date: "2026-06-15",
      part: "premorning",
    });
  });
});

describe("the 02:00 day boundary", () => {
  it("at 00:30 today is still the previous calendar date", () => {
    expect(currentDateIso(new Date("2026-06-15T00:30:00Z"))).toBe("2026-06-14");
  });

  it("at 01:59 today is still the previous calendar date, and at 02:00 it is not", () => {
    expect(currentDateIso(new Date("2026-06-15T01:59:00Z"))).toBe("2026-06-14");
    expect(currentDateIso(new Date("2026-06-15T02:00:00Z"))).toBe("2026-06-15");
  });

  it("names the date the clock reads for the rest of the day", () => {
    expect(currentDateIso(new Date("2026-06-15T10:00:00Z"))).toBe("2026-06-15");
    expect(currentDateIso(new Date("2026-06-15T23:59:00Z"))).toBe("2026-06-15");
  });

  it("rolls an hour back to the previous day only below the boundary", () => {
    expect(dayScopeDate("2026-06-15", 0)).toBe("2026-06-14");
    expect(dayScopeDate("2026-06-15", 1)).toBe("2026-06-14");
    expect(dayScopeDate("2026-06-15", 2)).toBe("2026-06-15");
    expect(dayScopeDate("2026-06-15", 22)).toBe("2026-06-15");
  });

  it("closes a window ending at 02:00 on the previous day", () => {
    // A Day's own window, and its Night's, both end at 02:00 the next morning.
    expect(lastDayOfWindow("2026-06-16T02:00:00")).toBe("2026-06-15");
    expect(lastDayOfWindow("2026-06-16T00:00:00")).toBe("2026-06-15");
    expect(lastDayOfWindow("2026-06-16T06:00:00")).toBe("2026-06-16");
    expect(lastDayOfWindow("2026-06-16T02:30:00")).toBe("2026-06-16");
  });
});

describe("isCellCurrent", () => {
  it("marks exactly one part of day, on the date that part belongs to", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    const current = partCells("2026-06-15").filter((cell) => isCellCurrent(cell, now));
    expect(current.map((cell) => cell.label)).toEqual(["Morning"]);
    expect(partCells("2026-06-14").filter((cell) => isCellCurrent(cell, now))).toEqual([]);
  });

  it("at 00:30 marks the previous date's Night and nothing on the clock's date", () => {
    const now = new Date("2026-06-15T00:30:00Z");
    expect(partCells("2026-06-14").filter((cell) => isCellCurrent(cell, now)).map((c) => c.label))
      .toEqual(["Night"]);
    expect(partCells("2026-06-15").filter((cell) => isCellCurrent(cell, now))).toEqual([]);
  });

  it("marks the cell containing today in the coarser views", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    const current = monthCells(2026).filter((cell) => isCellCurrent(cell, now));
    expect(current.map((cell) => cell.label)).toEqual(["June 2026"]);
  });

  it("at 00:30 on the 1st marks the previous month, because the day has not turned over", () => {
    const now = new Date("2026-07-01T00:30:00Z");
    const current = monthCells(2026).filter((cell) => isCellCurrent(cell, now));
    expect(current.map((cell) => cell.label)).toEqual(["June 2026"]);
  });

  it("at 00:30 marks the previous day's cell in the day view", () => {
    const now = new Date("2026-06-15T00:30:00Z");
    const current = dayCells("2026-06-15").filter((cell) => isCellCurrent(cell, now));
    expect(current.map((cell) => cell.label)).toEqual(["14"]);
  });
});

describe("openingForRef", () => {
  it("opens a canonical ref on its own view, anchored on its date", () => {
    expect(openingForRef({ kind: "day", date: "2026-09-16" })).toEqual({
      kind: "day",
      anchor: "2026-09-16",
    });
    expect(openingForRef({ kind: "season", date: "2026-09-01" })).toEqual({
      kind: "season",
      anchor: "2026-09-01",
    });
  });

  it("opens a part-of-day ref on the part view of its date", () => {
    expect(openingForRef({ kind: "part_of_day", date: "2026-09-16", part: "night" })).toEqual({
      kind: "part_of_day",
      anchor: "2026-09-16",
    });
  });

  it("opens an exact window on the day holding its start", () => {
    expect(
      openingForRef({ kind: "exact", start: "2026-09-16T14:30:00", end: "2026-09-16T15:00:00" }),
    ).toEqual({ kind: "day", anchor: "2026-09-16" });
  });
});

describe("openingForRefs", () => {
  it("is null for no refs, leaving the caller's default", () => {
    expect(openingForRefs([])).toBeNull();
  });

  it("opens a same-kind range at that kind, anchored on the earlier endpoint", () => {
    expect(
      openingForRefs([
        { kind: "week", date: "2026-09-20" },
        { kind: "week", date: "2026-09-06" },
      ]),
    ).toEqual({ kind: "week", anchor: "2026-09-06" });
  });

  it("opens a mixed-kind range at the coarser of the two views", () => {
    expect(
      openingForRefs([
        { kind: "day", date: "2026-09-16" },
        { kind: "month", date: "2026-10-01" },
      ]),
    ).toEqual({ kind: "month", anchor: "2026-09-16" });
  });
});

describe("openingForScopes", () => {
  function scope(fields: Partial<Scope>): Scope {
    return {
      id: 1, kind: "day", label: "", start_date: "2026-09-16", end_date: "2026-09-16",
      week_id: null, month_id: null, season_id: null, day_id: null,
      part: null, start_datetime: null, end_datetime: null,
      ...fields,
    };
  }

  it("opens on a stored Day scope's own day", () => {
    const day = scope({ kind: "day", start_date: "2026-09-16" });
    expect(openingForScopes([day, day])).toEqual({ kind: "day", anchor: "2026-09-16" });
  });

  it("drops a row that names no calendar cell", () => {
    const broken = scope({ kind: "part_of_day", part: null });
    expect(openingForScopes([broken, broken])).toBeNull();
  });
});
