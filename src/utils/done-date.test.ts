import { describe, it, expect } from "vitest";
import { fromDoneDateInput, nowDoneDateInput, toDoneDateInput } from "./done-date";

describe("done date input", () => {
  it("drops the seconds for the field and puts them back for the backend", () => {
    expect(toDoneDateInput("2026-09-26T19:05:41")).toBe("2026-09-26T19:05");
    expect(fromDoneDateInput("2026-09-26T19:05")).toBe("2026-09-26T19:05:00");
  });

  it("reads no done date as an empty field", () => {
    expect(toDoneDateInput(null)).toBe("");
  });

  it("formats now in local wall-clock time", () => {
    expect(nowDoneDateInput(new Date(2026, 8, 6, 7, 3))).toBe("2026-09-06T07:03");
  });
});
