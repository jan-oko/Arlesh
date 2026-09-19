import { describe, expect, it } from "vitest";
import { tabLabel } from "./tab-label";

describe("what a tab is called", () => {
  it("uses the subtree it is rooted at when it has no name of its own", () => {
    expect(tabLabel({ title: "CODE", customTitle: null }, "All")).toBe("CODE");
  });

  it("falls back to the whole-tree label rather than leaving a tab nameless", () => {
    expect(tabLabel({ title: null, customTitle: null }, "All")).toBe("All");
  });

  it("prefers the name the user gave over the derived one", () => {
    expect(tabLabel({ title: "CODE", customTitle: "Today" }, "All")).toBe("Today");
  });

  it("lets a named whole-tree tab keep its name", () => {
    expect(tabLabel({ title: null, customTitle: "Inbox" }, "All")).toBe("Inbox");
  });
});
