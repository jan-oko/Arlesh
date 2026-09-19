import { beforeEach, describe, expect, it } from "vitest";
import { useClipboardStore } from "./use-clipboard-store";
import { reloadTabs, useTabsStore } from "./use-tabs-store";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  useClipboardStore.setState({ clipboard: null });
});

describe("setClipboard / clipboard", () => {
  it("stores a clipboard entry", () => {
    useClipboardStore.getState().setClipboard({ operation: "cut", nodeIds: ["node-1"] });
    expect(useClipboardStore.getState().clipboard).toEqual({ operation: "cut", nodeIds: ["node-1"] });
  });

  it("clears clipboard when set to null", () => {
    useClipboardStore.getState().setClipboard({ operation: "copy", nodeIds: ["x"] });
    useClipboardStore.getState().setClipboard(null);
    expect(useClipboardStore.getState().clipboard).toBeNull();
  });
});

describe("the clipboard across tabs", () => {
  it("survives switching tabs, so a subtree copied in one pastes in another", () => {
    const opened = useTabsStore.getState().openTab();
    useClipboardStore.getState().setClipboard({ operation: "copy", nodeIds: ["task-1"] });

    useTabsStore.getState().activateTab(opened);

    expect(useClipboardStore.getState().clipboard).toEqual({ operation: "copy", nodeIds: ["task-1"] });
  });

  it("is not something a tab holds, so it is not written down with the strip either", () => {
    useClipboardStore.getState().setClipboard({ operation: "cut", nodeIds: ["task-1"] });
    expect(localStorage.getItem("arlesh-tabs")).not.toContain("task-1");
  });
});
