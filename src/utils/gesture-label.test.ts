import { describe, it, expect } from "vitest";
import { describeChanges } from "./gesture-label";
import type { GestureSummary } from "@/api/gesture";

function summary(over: Partial<GestureSummary> = {}): GestureSummary {
  return { gesture: "g1", rows: 0, inserted: 0, updated: 0, deleted: 0, tables: [], ...over };
}

describe("describeChanges", () => {
  it("calls a gesture that only created rows a create, counting the rows it created", () => {
    expect(describeChanges(summary({ rows: 3, inserted: 3, tables: ["tasks"] })))
      .toEqual({ verb: "create", count: 3 });
  });

  it("calls a gesture that only rewrote rows an update", () => {
    expect(describeChanges(summary({ rows: 1, updated: 1, tables: ["tasks"] })))
      .toEqual({ verb: "update", count: 1 });
  });

  it("calls a gesture that only removed rows a delete", () => {
    expect(describeChanges(summary({ rows: 4, deleted: 4, tables: ["tasks", "task_tags"] })))
      .toEqual({ verb: "delete", count: 4 });
  });

  // Naming a mixed gesture after whichever count happened to be largest would tell the user it was
  // a delete when it also created something. "change" says less and stays true.
  it("calls a gesture that did more than one kind of thing a change, over every row", () => {
    expect(describeChanges(summary({ rows: 5, inserted: 1, deleted: 4, tables: ["tasks"] })))
      .toEqual({ verb: "change", count: 5 });
  });

  it("calls a gesture with no rows at all a change of nothing", () => {
    expect(describeChanges(summary())).toEqual({ verb: "change", count: 0 });
  });
});
