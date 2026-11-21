import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OPEN_TASK_EVENT } from "@/api/push";
import { useOpenNotifiedTask } from "@/hooks/use-open-notified-task";

const selectNode = vi.fn();
vi.mock("@/stores/tab-stores-context", () => ({
  activeTabStores: () => ({ mindmap: { getState: () => ({ selectNode }) } }),
}));

const openReviewList = vi.fn();
vi.mock("@/utils/open-review-list", () => ({
  openReviewList: (task: string | null, opening: string) => { openReviewList(task, opening); },
}));

let clicked: ((task: string) => void) | null = null;
vi.mock("@/api/notifications", () => ({
  onOpenReview: (handler: (task: string) => void) => {
    clicked = handler;
    return Promise.resolve(() => { clicked = null; });
  },
}));

const opened: string[] = [];
const bridge = {
  available: () => true,
  allowed: () => true,
  requestPermission: vi.fn(),
  fetchToken: vi.fn(),
  openSettings: vi.fn(),
  takeOpenedNotification: () => opened.shift() ?? "",
};

const tap = (task: string | null, channel: string): string => JSON.stringify({ task, channel });

beforeEach(() => {
  vi.clearAllMocks();
  opened.length = 0;
  clicked = null;
});
afterEach(() => { Reflect.deleteProperty(window, "ArleshPush"); });

describe("useOpenNotifiedTask on the phone", () => {
  beforeEach(() => { Reflect.set(window, "ArleshPush", bridge); });

  it("opens the Review list for the question a cold start was tapped for", () => {
    opened.push(tap("task-12", "agent_question"));
    renderHook(() => useOpenNotifiedTask());
    expect(openReviewList).toHaveBeenCalledWith("task-12", "replace-view");
  });

  it("opens the Review list for a tap while running, once", () => {
    renderHook(() => useOpenNotifiedTask());
    expect(openReviewList).not.toHaveBeenCalled();

    opened.push(tap("task-7", "agent_question"));
    act(() => { window.dispatchEvent(new Event(OPEN_TASK_EVENT)); });
    act(() => { window.dispatchEvent(new Event(OPEN_TASK_EVENT)); });

    expect(openReviewList).toHaveBeenCalledTimes(1);
    expect(openReviewList).toHaveBeenCalledWith("task-7", "replace-view");
  });

  it("keeps selecting the Task for the other kinds of notification", () => {
    opened.push(tap("task-9", "task_overdue"));
    renderHook(() => useOpenNotifiedTask());
    expect(selectNode).toHaveBeenCalledWith("task-9");
    expect(openReviewList).not.toHaveBeenCalled();
  });
});

describe("useOpenNotifiedTask on the desktop", () => {
  it("shows the Review list in a tab when the shell reports a click", async () => {
    renderHook(() => useOpenNotifiedTask());
    await act(async () => { await Promise.resolve(); });

    act(() => { clicked?.("task-5"); });

    expect(openReviewList).toHaveBeenCalledWith("task-5", "tab");
  });
});
