import { describe, it, expect } from "vitest";
import { capitalised, shortAge } from "./agents";

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
