import { describe, it, expect } from "vitest";
import { defaultRecurrence, effectiveCooldown, maxCooldown, recurrenceRequest, type RecurrenceUi } from "./recurrence-ui";

const WITH_COOLDOWN: RecurrenceUi = {
  ...defaultRecurrence("2026-09-20"), isHabit: true, cooldownEnabled: true, cooldownN: 1, cooldownKind: "day",
};

describe("maxCooldown", () => {
  it("stops one short of the shortest window a unit tiles", () => {
    expect(maxCooldown("day", "week", 1)).toBe(6);
    expect(maxCooldown("day", "week", 2)).toBe(13);
    expect(maxCooldown("part", "day", 1)).toBe(5);
    expect(maxCooldown("day", "month", 1)).toBe(27);
    expect(maxCooldown("month", "season", 1)).toBe(2);
  });

  it("gives up the six days a week can straddle into a month", () => {
    expect(maxCooldown("week", "month", 1)).toBe(3);
  });
});

describe("effectiveCooldown", () => {
  it("is none off a Window clock, or switched off", () => {
    expect(effectiveCooldown(WITH_COOLDOWN, "interval", "week", 1)).toEqual({ cooldownN: null, cooldownKind: null });
    expect(effectiveCooldown({ ...WITH_COOLDOWN, missPolicy: "owed" }, "window", "week", 1))
      .toEqual({ cooldownN: 1, cooldownKind: "day" });
    expect(effectiveCooldown({ ...WITH_COOLDOWN, cooldownEnabled: false }, "window", "week", 1))
      .toEqual({ cooldownN: null, cooldownKind: null });
  });

  it("reads a unit the window no longer takes as the first it does, and clamps the count", () => {
    expect(effectiveCooldown({ ...WITH_COOLDOWN, cooldownN: 9 }, "window", "day", 1))
      .toEqual({ cooldownN: 5, cooldownKind: "part" });
  });

  it("is what the request carries", () => {
    const request = recurrenceRequest({
      startDate: "2026-09-20", gapN: null, gapKind: null, endDate: null,
      clock: "window", missPolicy: "archive",
      ...effectiveCooldown(WITH_COOLDOWN, "window", "week", 1),
    }, "week");
    expect(request).toMatchObject({ cooldown_n: 1, cooldown_kind: "day" });
  });
});
