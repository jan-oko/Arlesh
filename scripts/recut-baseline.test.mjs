import { describe, it, expect } from "vitest";
import { latestMigration, needsRecut, parseVersion } from "./recut-baseline.mjs";

describe("latestMigration", () => {
  it("is the highest number, not the last name listed", () => {
    expect(latestMigration(["0094_b.sql", "0095_c.sql", "0001_a.sql", "legacy"])).toBe(95);
  });

  it("ignores anything that is not a numbered .sql file", () => {
    expect(latestMigration(["README.md", "0003_x.sql", "0100.sql"])).toBe(3);
  });

  it("refuses an empty directory", () => {
    expect(() => latestMigration(["README.md"])).toThrow("no migrations found");
  });
});

describe("parseVersion", () => {
  it("reads a number with its newline", () => {
    expect(parseVersion("94\n")).toBe(94);
  });

  it("refuses anything else", () => {
    expect(() => parseVersion("94 95")).toThrow();
    expect(() => parseVersion("")).toThrow();
  });
});

describe("needsRecut", () => {
  it("re-cuts when a newer migration exists", () => {
    expect(needsRecut({ latest: 95, current: 94, force: false })).toBe(true);
  });

  it("leaves a baseline that is in step alone", () => {
    expect(needsRecut({ latest: 94, current: 94, force: false })).toBe(false);
  });

  it("regenerates an in-step baseline when forced", () => {
    expect(needsRecut({ latest: 94, current: 94, force: true })).toBe(true);
  });
});
