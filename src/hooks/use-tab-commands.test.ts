import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTabCommands } from "./use-tab-commands";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { closeWindow } from "@/api/window";

vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi());

const mockCloseWindow = vi.mocked(closeWindow);

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockCloseWindow.mockClear();
});

describe("opening a tab", () => {
  it("starts it at the subtree the current tab is in, so looking at something nearby costs no navigation", () => {
    useTabsStore.getState().tabs[0]?.stores.mindmap.getState().enterSubtree("project-1");
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.openTab());

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.id).toBe(activeTabId);
    expect(tabs[1]?.stores.mindmap.getState().subtreeRootId).toBe("project-1");
  });

  it("gives the new tab fresh filters rather than the current tab's", () => {
    useTabsStore.getState().tabs[0]?.stores.filter.getState().setStatusMode("do");
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.openTab());

    expect(useTabsStore.getState().tabs[1]?.stores.filter.getState().filter.statusMode).toBe("all");
  });
});

describe("closing a tab", () => {
  it("closes the active one by default", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const opened = useTabsStore.getState().activeTabId;

    act(() => result.current.closeTab());

    expect(useTabsStore.getState().tabs.some((tab) => tab.id === opened)).toBe(false);
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it("closes the window rather than leaving an empty one when the last tab goes", () => {
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.closeTab());

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });
});

describe("moving between tabs", () => {
  it("cycles forward and backward", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const ids = useTabsStore.getState().tabs.map((tab) => tab.id);

    act(() => result.current.nextTab());
    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);

    act(() => result.current.previousTab());
    expect(useTabsStore.getState().activeTabId).toBe(ids[1]);
  });

  it("jumps by position, counting from one as the shortcuts name it", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const ids = useTabsStore.getState().tabs.map((tab) => tab.id);

    act(() => result.current.jumpToTab(1));

    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);
  });
});
