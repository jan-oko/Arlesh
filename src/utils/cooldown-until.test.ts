import { describe, it, expect } from "vitest";
import { formatCooldownUntil } from "./cooldown-until";

describe("formatCooldownUntil", () => {
  it("names the weekday, the day and the time the cooldown lifts", () => {
    expect(formatCooldownUntil("2026-10-05T02:00:00")).toBe("Mon 5 Oct, 02:00");
  });

  it("gives back what it cannot read", () => {
    expect(formatCooldownUntil("soon")).toBe("soon");
  });
});
