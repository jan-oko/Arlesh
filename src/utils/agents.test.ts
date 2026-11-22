import { describe, it, expect } from "vitest";
import { capitalised, limitsText, shortAge, shortRemaining } from "./agents";

const NOW = new Date("2026-11-08T12:00:00");

describe("shortAge", () => {
  it("is the shortest unit that fits", () => {
    expect(shortAge("2026-11-08T10:00:00", NOW, "en")).toBe("2h");
    expect(shortAge("2026-11-08T11:55:00", NOW, "en")).toBe("5m");
    expect(shortAge("2026-11-05T12:00:00", NOW, "en")).toBe("3d");
  });

  it("is never negative for a time in the future", () => {
    expect(shortAge("2026-11-08T13:00:00", NOW, "en")).toBe("0s");
  });
});

describe("capitalised", () => {
  it("upper-cases the first letter only", () => {
    expect(capitalised("work")).toBe("Work");
    expect(capitalised("")).toBe("");
  });
});

describe("shortRemaining", () => {
  it("is the shortest unit that fits, counted forward", () => {
    expect(shortRemaining("2026-11-08T16:00:00", NOW, "en")).toBe("4h");
    expect(shortRemaining("2026-11-10T12:00:00", NOW, "en")).toBe("2d");
  });

  it("is never negative for a time in the past", () => {
    expect(shortRemaining("2026-11-08T11:00:00", NOW, "en")).toBe("0s");
  });
});

describe("limitsText", () => {
  const words = {
    name: (kind: string) => (kind === "five_hour" ? "Five Hours" : "Week"),
    limit: (name: string, percent: number, left: string) => `${name}: ${percent}% (${left} left)`,
    separator: " · ",
  };

  it("joins each window as name, percent used and time left", () => {
    const windows = [
      { kind: "five_hour", percent_used: 7.6, resets_at: "2026-11-08T16:00:00" },
      { kind: "seven_day", percent_used: 20, resets_at: "2026-11-10T12:00:00" },
    ];
    expect(limitsText(windows, NOW, words, "en")).toBe("Five Hours: 8% (4h left) · Week: 20% (2d left)");
  });

  it("is empty when no window is reported", () => {
    expect(limitsText([], NOW, words, "en")).toBe("");
  });
});
