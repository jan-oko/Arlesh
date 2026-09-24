import { describe, it, expect } from "vitest";
import { testKey } from "@/test/scope-key";
import { formatScope, formatScopeAnchor, formatScopeCore, formatScopeRange } from "./scope-format";
import type { Scope } from "@/api/scopes";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const labels: ScopeLabelFns = {
  month: (m) => MONTHS[m - 1] ?? "",
  season: (name) => name,
  week: (n) => `W${n}`,
};

function mk(_id: number, kind: Scope["kind"], startDate: string, label = ""): Scope {
  return {
    id: testKey(0), kind, label, start_date: startDate, end_date: startDate,
    part: null, start_datetime: null, end_datetime: null,
  };
}

describe("formatScope (single)", () => {
  it("renders a day as dd/mm/yy", () => {
    expect(formatScope(mk(1, "day", "2026-06-20"), labels)).toBe("20/06/26");
  });
  it("renders a month by name with the year", () => {
    expect(formatScope(mk(1, "month", "2026-06-01"), labels)).toBe("June 2026");
  });
  it("renders a season by name with the year", () => {
    expect(formatScope(mk(1, "season", "2026-06-01"), labels)).toBe("Summer 2026");
  });
  it("renders a week as W{n} with the year", () => {
    expect(formatScope(mk(1, "week", "2026-06-14"), labels)).toMatch(/^W\d+ 2026$/);
  });
});

describe("formatScopeAnchor", () => {
  it("renders a day as dd/mm/yy", () => {
    expect(formatScopeAnchor("day", "2026-06-20", labels)).toBe("20/06/26");
  });
  it("renders a month by name with the year", () => {
    expect(formatScopeAnchor("month", "2026-06-01", labels)).toBe("June 2026");
  });
  it("renders a season by name with the year", () => {
    expect(formatScopeAnchor("season", "2026-06-01", labels)).toBe("Summer 2026");
  });
  it("renders a week as W{n} with the year", () => {
    expect(formatScopeAnchor("week", "2026-06-14", labels)).toMatch(/^W\d+ 2026$/);
  });
  it("agrees with formatScope for the same kind/date", () => {
    expect(formatScopeAnchor("week", "2026-06-14", labels)).toBe(formatScope(mk(1, "week", "2026-06-14"), labels));
  });
});

describe("formatScopeCore", () => {
  it("renders a day without the year", () => {
    expect(formatScopeCore("day", "2026-06-20", labels)).toBe("20/06");
  });
  it("renders a month by name without the year", () => {
    expect(formatScopeCore("month", "2026-06-01", labels)).toBe("June");
  });
  it("renders a season by name without the year", () => {
    expect(formatScopeCore("season", "2026-06-01", labels)).toBe("Summer");
  });
  it("renders a week as W{n} without the year", () => {
    expect(formatScopeCore("week", "2026-06-14", labels)).toMatch(/^W\d+$/);
  });
});

describe("formatScopeRange", () => {
  it("collapses to a single scope when both ids match", () => {
    const scope = mk(3, "month", "2026-06-01");
    expect(formatScopeRange(scope, scope, labels)).toBe("June 2026");
  });

  it("factors out a shared year for a month range", () => {
    expect(formatScopeRange(mk(1, "month", "2026-06-01"), mk(2, "month", "2026-08-01"), labels)).toBe(
      "June-August 2026",
    );
  });

  it("keeps both years when a month range spans years", () => {
    expect(formatScopeRange(mk(1, "month", "2026-12-01"), mk(2, "month", "2027-01-01"), labels)).toBe(
      "December 2026-January 2027",
    );
  });

  it("factors out a shared year for a day range (dd/mm-dd/mm YYYY)", () => {
    expect(formatScopeRange(mk(1, "day", "2026-06-28"), mk(2, "day", "2026-07-01"), labels)).toBe(
      "28/06-01/07 2026",
    );
  });

  it("uses dd/mm/yy on both sides when a day range spans years", () => {
    expect(formatScopeRange(mk(1, "day", "2026-12-28"), mk(2, "day", "2027-01-05"), labels)).toBe(
      "28/12/26-05/01/27",
    );
  });

  it("factors out a shared year for a week range", () => {
    expect(formatScopeRange(mk(1, "week", "2026-06-14"), mk(2, "week", "2026-07-12"), labels)).toMatch(
      /^W\d+-W\d+ 2026$/,
    );
  });
});
