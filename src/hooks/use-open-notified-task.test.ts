import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OPEN_TASK_EVENT } from "@/api/push";
import { useOpenNotifiedTask } from "@/hooks/use-open-notified-task";

const selectNode = vi.fn();
vi.mock("@/stores/tab-stores-context", () => ({
  activeTabStores: () => ({ mindmap: { getState: () => ({ selectNode }) } }),
}));

const opened: string[] = [];
const bridge = {
  available: () => true,
  allowed: () => true,
  requestPermission: vi.fn(),
  fetchToken: vi.fn(),
  openSettings: vi.fn(),
  takeOpenedTask: () => opened.shift() ?? "",
};

beforeEach(() => {
  vi.clearAllMocks();
  opened.length = 0;
  Reflect.set(window, "ArleshPush", bridge);
});
afterEach(() => { Reflect.deleteProperty(window, "ArleshPush"); });

describe("useOpenNotifiedTask", () => {
  it("opens the Task a cold start was tapped for", () => {
    opened.push("task-12");
    renderHook(() => useOpenNotifiedTask());
    expect(selectNode).toHaveBeenCalledWith("task-12");
  });

  it("opens the Task a tap names while the app is running, once", () => {
    renderHook(() => useOpenNotifiedTask());
    expect(selectNode).not.toHaveBeenCalled();

    opened.push("task-7");
    act(() => { window.dispatchEvent(new Event(OPEN_TASK_EVENT)); });
    act(() => { window.dispatchEvent(new Event(OPEN_TASK_EVENT)); });

    expect(selectNode).toHaveBeenCalledTimes(1);
    expect(selectNode).toHaveBeenCalledWith("task-7");
  });
});
