import { describe, expect, it } from "vitest";
import { DELEGATED_KEY, FILTER_MENU_CODES, filterMenuCodesFor } from "./filter-menu-keys";

describe("the Delegated pill's key", () => {
  it("is g, held by the menu in every view so the canvas's own g does not fire", () => {
    expect(DELEGATED_KEY).toBe("KeyG");
    expect(filterMenuCodesFor([], [])).toEqual(["KeyG"]);
    expect(FILTER_MENU_CODES).toContain("KeyG");
  });

  it("is no row kind's and no flag's", () => {
    const others = filterMenuCodesFor(["task", "commitment", "expectation"], ["agentic", "asynchronous", "blocked", "private"]);
    expect(others.filter((code) => code === "KeyG")).toHaveLength(1);
  });
});
