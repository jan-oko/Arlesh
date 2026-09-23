import { describe, it, expect } from "vitest";
import { neighbourAfterDelete } from "./neighbour-after-delete";

describe("neighbourAfterDelete", () => {
  const order = ["a", "b", "c", "d"];

  it("lands on the next item", () => {
    expect(neighbourAfterDelete(order, "b", new Set(["b"]))).toBe("c");
  });

  it("skips what went with it", () => {
    expect(neighbourAfterDelete(order, "b", new Set(["b", "c"]))).toBe("d");
  });

  it("falls back to the one before when the last item goes", () => {
    expect(neighbourAfterDelete(order, "d", new Set(["d"]))).toBe("c");
  });

  it("is null when nothing survives, or the item is not in the order", () => {
    expect(neighbourAfterDelete(["a"], "a", new Set(["a"]))).toBeNull();
    expect(neighbourAfterDelete(order, "z", new Set(["z"]))).toBeNull();
  });
});
