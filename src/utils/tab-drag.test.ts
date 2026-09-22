import { describe, expect, it } from "vitest";
import { tabDrop } from "./tab-drag";

const OWN = "main";

describe("a drag that started on a tab", () => {
  it("is a reorder when the strip took the drop", () => {
    expect(tabDrop("board-a", OWN, true)).toEqual({ kind: "reorder" });
  });

  it("moves the tab when it was released over another window", () => {
    expect(tabDrop("board-a", OWN, false)).toEqual({ kind: "move", label: "board-a" });
  });

  it("tears the tab off when it was released over no window at all", () => {
    expect(tabDrop(null, OWN, false)).toEqual({ kind: "tearOff" });
  });

  it("does nothing when it was released over the window it came from", () => {
    // Its board, the empty part of its strip, its title bar: all the same gesture, which went
    // nowhere. A window cannot hand a tab to itself.
    expect(tabDrop(OWN, OWN, false)).toEqual({ kind: "nothing" });
  });

  it("does nothing when the platform could not say where the pointer was", () => {
    // Deliberately not read as "the desktop". A gesture that has to be repeated costs a keystroke;
    // a window that appears from nowhere costs finding it and closing it.
    expect(tabDrop(undefined, OWN, false)).toEqual({ kind: "nothing" });
  });

  it("still reorders when the strip took the drop and the position is unknown", () => {
    expect(tabDrop(undefined, OWN, true)).toEqual({ kind: "reorder" });
  });
});
