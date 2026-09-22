import { beforeEach, describe, expect, it } from "vitest";
import { useClipboardStore } from "./use-clipboard-store";
import { reloadTabs, useTabsStore } from "./use-tabs-store";
import { windowTabsKey } from "./tab-persistence";
import { BOOTSTRAP_WINDOW_LABEL } from "@/api/window-label";

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

    // The strip a window stores is its own, under its own label — see `tab-persistence`.
    const stored = localStorage.getItem(windowTabsKey(BOOTSTRAP_WINDOW_LABEL));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("task-1");
  });
});
