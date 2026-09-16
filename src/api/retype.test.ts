import { describe, it, expect } from "vitest";
import { asRetypeKind, retypeLosses } from "@/api/retype";

/** A `needs_confirmation` wire error carrying `details`, as `retype_node` rejects with. */
function refusal(details: unknown): unknown {
  return { kind: "needs_confirmation", message: "retype would lose something", details };
}

describe("asRetypeKind", () => {
  it("accepts info, now that retype_node owns the infos table too", () => {
    expect(asRetypeKind("info")).toBe("info");
  });

  it("accepts the five table-backed kinds", () => {
    for (const kind of ["goal", "task", "domain", "project", "tag"]) {
      expect(asRetypeKind(kind)).toBe(kind);
    }
  });

  it("refuses the kinds that convert through their own command, and aspect", () => {
    for (const kind of ["flow", "flow_goal", "flow_task", "aspect"]) {
      expect(asRetypeKind(kind)).toBeNull();
    }
  });
});

describe("retypeLosses — parent_climb", () => {
  const EMPTY = { lost_children: [], lost_fields: [] };
  const CLIMB = {
    from: { kind: "info", id: 5, title: "Parent note" },
    to: { kind: "goal", id: 2, title: "Ship it" },
  };

  it("reads the climb the backend named", () => {
    expect(retypeLosses(refusal({ ...EMPTY, parent_climb: CLIMB }))?.parent_climb).toEqual(CLIMB);
  });

  it("reports no climb when the key is explicitly null", () => {
    expect(retypeLosses(refusal({ ...EMPTY, parent_climb: null }))?.parent_climb).toBeNull();
  });

  // Every fixture written before this key existed omits it entirely rather than sending null.
  it("reports no climb when the key is absent altogether", () => {
    const losses = retypeLosses(refusal(EMPTY));
    expect(losses).not.toBeNull();
    expect(losses?.parent_climb).toBeNull();
  });

  it("ignores a malformed climb rather than rejecting the whole refusal", () => {
    // The losses still have to reach the user; a bad climb must not swallow them.
    const details = {
      lost_fields: [{ field: "details", value: "a long note" }],
      lost_children: [],
      parent_climb: { from: { kind: "info", id: "five", title: "Parent note" }, to: CLIMB.to },
    };
    const losses = retypeLosses(refusal(details));
    expect(losses?.parent_climb).toBeNull();
    expect(losses?.lost_fields).toHaveLength(1);
  });
});
