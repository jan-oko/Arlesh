import { beforeEach, describe, expect, it } from "vitest";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { openReviewList } from "@/utils/open-review-list";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
});

function tabs() {
  return useTabsStore.getState().tabs;
}

function active() {
  const { tabs: all, activeTabId } = useTabsStore.getState();
  const found = all.find((tab) => tab.id === activeTabId);
  if (found === undefined) throw new Error("no active tab");
  return found;
}

describe("openReviewList as a tab (the desktop)", () => {
  it("opens a new List tab on the Review preset and selects the Task", () => {
    const before = tabs().length;

    openReviewList({ task: "task-12", wait: null }, "tab");

    expect(tabs()).toHaveLength(before + 1);
    expect(active().stores.view.getState().view).toBe("list");
    expect(active().stores.listFilter.getState().filter.preset).toBe("review");
    expect(active().stores.mindmap.getState().requestedSelection).toBe("task-12");
  });

  it("reuses a List tab already on the Review preset, switching to it", () => {
    openReviewList({ task: "task-1", wait: null }, "tab");
    const reviewTab = active().id;
    useTabsStore.getState().openTab();
    const count = tabs().length;

    openReviewList({ task: "task-2", wait: null }, "tab");

    expect(tabs()).toHaveLength(count);
    expect(active().id).toBe(reviewTab);
    expect(active().stores.mindmap.getState().requestedSelection).toBe("task-2");
  });

  it("does not reuse a Review list that is stepped into a subtree", () => {
    openReviewList({ task: "task-1", wait: null }, "tab");
    active().stores.mindmap.getState().enterSubtree("project-3");
    const count = tabs().length;

    openReviewList({ task: "task-2", wait: null }, "tab");

    expect(tabs()).toHaveLength(count + 1);
  });

  it("opens the list with nothing selected when the notification names no Task", () => {
    openReviewList({ task: null, wait: null }, "tab");

    expect(active().stores.listFilter.getState().filter.preset).toBe("review");
    expect(active().stores.mindmap.getState().requestedSelection).toBeNull();
  });
});

describe("openReviewList in place (the phone)", () => {
  it("turns the active tab into the Review list over the whole board, without adding a tab", () => {
    active().stores.mindmap.getState().enterSubtree("project-3");
    const count = tabs().length;

    openReviewList({ task: "task-12", wait: null }, "replace-view");

    expect(tabs()).toHaveLength(count);
    expect(active().stores.view.getState().view).toBe("list");
    expect(active().stores.listFilter.getState().filter.preset).toBe("review");
    expect(active().stores.mindmap.getState().subtreeRootId).toBeNull();
    expect(active().stores.mindmap.getState().requestedSelection).toBe("task-12");
  });
});

describe("openReviewList with the wait", () => {
  it("asks the desktop to focus the wait's box", () => {
    openReviewList({ task: "task-12", wait: "w-1" }, "tab");

    expect(active().stores.mindmap.getState().requestedWait).toEqual({ id: "w-1", focus: true });
  });

  it("asks the phone to show the box without focusing it, so the keyboard stays down", () => {
    openReviewList({ task: "task-12", wait: "w-1" }, "replace-view");

    expect(active().stores.mindmap.getState().requestedWait).toEqual({ id: "w-1", focus: false });
  });

  it("asks for no box when the notification names no wait", () => {
    openReviewList({ task: "task-12", wait: null }, "tab");

    expect(active().stores.mindmap.getState().requestedWait).toBeNull();
  });
});

describe("a Review tab opened this way", () => {
  it("is written down with the strip like any other", () => {
    openReviewList({ task: "task-12", wait: null }, "tab");

    const saved = localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("arlesh-window:")) ?? "");
    expect(saved).toContain("review");
  });
});
