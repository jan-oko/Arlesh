import { describe, it, expect } from "vitest";
import {
  EMPTY_PLAN_SELECTION, navigateSelection, pruneSelection, selectOnly, selectRange, selectedInOrder,
  toggleSelected,
} from "./plan-selection";

const ORDER = ["a", "b", "c", "d"];

describe("navigateSelection", () => {
  it("lands on the first row when nothing is selected yet", () => {
    const next = navigateSelection(EMPTY_PLAN_SELECTION, ORDER, 1, false);
    expect(next.leadId).toBe("a");
    expect([...next.ids]).toEqual(["a"]);
  });

  it("lands on the last row going up from nothing", () => {
    expect(navigateSelection(EMPTY_PLAN_SELECTION, ORDER, -1, false).leadId).toBe("d");
  });

  it("replaces the selection unshifted, so Enter acts on the one row under the cursor", () => {
    const grown = selectRange(selectOnly("a"), ORDER, "c");
    const next = navigateSelection(grown, ORDER, 1, false);
    expect([...next.ids]).toEqual(["d"]);
  });

  it("grows the run from the anchor shifted", () => {
    const next = navigateSelection(selectOnly("b"), ORDER, 1, true);
    expect(selectedInOrder(next, ORDER)).toEqual(["b", "c"]);
    expect(next.anchorId).toBe("b");
  });

  it("shrinks the run back when the cursor turns round", () => {
    const grown = navigateSelection(navigateSelection(selectOnly("a"), ORDER, 1, true), ORDER, 1, true);
    expect(selectedInOrder(grown, ORDER)).toEqual(["a", "b", "c"]);
    const shrunk = navigateSelection(grown, ORDER, -1, true);
    expect(selectedInOrder(shrunk, ORDER)).toEqual(["a", "b"]);
  });

  it("stops at either end rather than wrapping", () => {
    expect(navigateSelection(selectOnly("d"), ORDER, 1, false).leadId).toBe("d");
    expect(navigateSelection(selectOnly("a"), ORDER, -1, false).leadId).toBe("a");
  });

  it("selects nothing in an empty pane", () => {
    expect(navigateSelection(selectOnly("a"), [], 1, false)).toEqual(EMPTY_PLAN_SELECTION);
  });
});

describe("selectRange", () => {
  it("takes the run between the anchor and the row, in drawn order, either way round", () => {
    expect(selectedInOrder(selectRange(selectOnly("c"), ORDER, "a"), ORDER)).toEqual(["a", "b", "c"]);
    expect(selectedInOrder(selectRange(selectOnly("a"), ORDER, "c"), ORDER)).toEqual(["a", "b", "c"]);
  });

  it("selects the one row when there is no anchor to reach from", () => {
    expect([...selectRange(EMPTY_PLAN_SELECTION, ORDER, "b").ids]).toEqual(["b"]);
  });
});

describe("toggleSelected", () => {
  it("adds a row and takes it back out", () => {
    const two = toggleSelected(selectOnly("a"), "c");
    expect(selectedInOrder(two, ORDER)).toEqual(["a", "c"]);
    expect(selectedInOrder(toggleSelected(two, "a"), ORDER)).toEqual(["c"]);
  });

  it("leaves the anchor where the pointer last was, either way the toggle went", () => {
    expect(toggleSelected(selectOnly("a"), "c").anchorId).toBe("c");
  });
});

describe("pruneSelection", () => {
  it("drops rows that are no longer drawn — a batch empties the pane it acted on", () => {
    const three = selectRange(selectOnly("a"), ORDER, "c");
    const left = pruneSelection(three, ["c", "d"]);
    expect(selectedInOrder(left, ["c", "d"])).toEqual(["c"]);
  });

  it("gives back the same selection untouched when everything is still there", () => {
    const three = selectRange(selectOnly("a"), ORDER, "c");
    expect(pruneSelection(three, ORDER)).toBe(three);
  });

  it("drops a cursor that went with the rows it was on", () => {
    expect(pruneSelection(selectOnly("a"), ["b", "c"])).toEqual(EMPTY_PLAN_SELECTION);
  });
});
