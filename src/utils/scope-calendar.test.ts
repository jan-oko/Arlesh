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
} from "./scope-calendar";

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
