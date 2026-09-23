import { describe, expect, it } from "vitest";
import { carriesTab, decodeTabDrag, encodeTabDrag, tabDrop, TAB_DRAG_TYPE } from "./tab-drag";

const OWN = "main";

describe("what a dragged tab carries", () => {
  it("reads back the tab and window it was given", () => {
    const payload = { tabId: "tab-1", window: "board-a" };
    expect(decodeTabDrag(encodeTabDrag(payload))).toEqual(payload);
  });

  it("ignores a drop whose data is not JSON, such as a file or a selection", () => {
    expect(decodeTabDrag("hello")).toBeNull();
  });

  it("ignores JSON that is not a tab", () => {
    expect(decodeTabDrag(JSON.stringify({ tabId: 7, window: "main" }))).toBeNull();
    expect(decodeTabDrag(JSON.stringify(["tab-1", "main"]))).toBeNull();
    expect(decodeTabDrag("null")).toBeNull();
  });

  it("recognises a tab drag by its type alone, since its data is unreadable until the drop", () => {
    expect(carriesTab(["text/plain", TAB_DRAG_TYPE])).toBe(true);
    expect(carriesTab(["text/plain", "Files"])).toBe(false);
  });
});

describe("a tab dropped on a window", () => {
  it("is this window's own business when it came from here", () => {
    expect(tabDrop({ tabId: "tab-1", window: OWN }, OWN)).toEqual({ kind: "own" });
  });

  it("is asked for from the window it came from", () => {
    expect(tabDrop({ tabId: "tab-1", window: "board-a" }, OWN)).toEqual({
      kind: "claim",
      from: "board-a",
      tabId: "tab-1",
    });
  });
});
