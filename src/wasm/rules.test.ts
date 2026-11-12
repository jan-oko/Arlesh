import { describe, expect, it } from "vitest";
import {
  altStep,
  mayParent,
  nextStatus,
  planRefusal,
  planTriage,
  statusAfter,
  takeOut,
  verdictAfter,
} from "@/wasm/rules";

/**
 * Smoke tests of the wasm boundary: every export loads in node and speaks the shapes its generated
 * declarations name. What each rule *means* is pinned by the conformance corpora, replayed against
 * this module by the `*-conformance.test.ts` files.
 */
describe("the rules module", () => {
  it("steps a status and predicts a press", () => {
    expect(nextStatus({ kind: "ordinary", status: "todo" })).toEqual({ kind: "ordinary", status: "in_progress" });
    expect(statusAfter("advance", { kind: "ordinary", status: "done" }, true, { floor: "todo", open: 0 })).toEqual({ outcome: "refused", reason: "compound" });
    expect(statusAfter("advance", { kind: "ordinary", status: "in_progress" }, false, { floor: "in_progress", open: 1 })).toEqual({ outcome: "refused", reason: "open_sub_items" });
    expect(altStep({ kind: "agentic", status: "todo" })).toEqual({ outcome: "refused", reason: "alt_enter_agentic_not_doing" });
  });

  it("cycles a verdict", () => {
    expect(verdictAfter("cycle", "unresolved")).toBe("kept");
  });

  it("answers the parenting table", () => {
    expect(mayParent("task", "project")).toBe(true);
    expect(mayParent("aspect", "project")).toBe(false);
  });

  it("triages an unscoped row as unplanned, and says where work taken out lands", () => {
    const target = { kind: "week", date: "2031-03-02" } as const;
    expect(planTriage({ target, parent: null, rows: [{ id: "a" }] })).toEqual({ unplanned: ["a"], planned: [], parentPlanned: [] });
    expect(planRefusal({ row: { id: "a" }, target })).toBeNull();
    expect(takeOut(false, false)).toBe("clear");
    expect(takeOut(true, false)).toBe("filled");
    expect(takeOut(false, true)).toBe("parent");
  });

  it("throws on a malformed argument instead of trapping", () => {
    // @ts-expect-error the declaration refuses a non-status; the module must refuse it at run time too
    expect(() => nextStatus({ kind: "nope" })).toThrow();
  });
});
