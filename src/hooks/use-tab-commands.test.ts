import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
// Real English, because the refusal a chord raises is the only thing that says why nothing
// happened — its wording is part of the feature, as it is for the undo toast.
import "@/i18n";
import { useTabCommands } from "./use-tab-commands";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { boardWindowLabels, closeWindow, focusBoardWindow, openBoardWindow } from "@/api/window";
import { sendTabToWindow } from "@/api/board";
import { readPersistedTabs } from "@/stores/tab-persistence";

vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi());
vi.mock("@/api/board", () => ({
  sendTabToWindow: vi.fn(() => Promise.resolve()),
  onBoardChanged: vi.fn(() => Promise.resolve(() => {})),
  onTabMoved: vi.fn(() => Promise.resolve(() => {})),
}));

const mockCloseWindow = vi.mocked(closeWindow);
const mockOpenWindow = vi.mocked(openBoardWindow);
const mockSendTab = vi.mocked(sendTabToWindow);
const mockFocusWindow = vi.mocked(focusBoardWindow);

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockCloseWindow.mockClear();
  mockOpenWindow.mockClear();
  mockOpenWindow.mockResolvedValue(undefined);
  mockSendTab.mockClear();
  mockSendTab.mockResolvedValue(undefined);
  mockFocusWindow.mockClear();
  vi.mocked(boardWindowLabels).mockResolvedValue(["main"]);
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

/** The label `openBoardWindow` was asked for, which is also the key the tab was written under. */
function openedWindowLabel(): string {
  const call = mockOpenWindow.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] ?? "";
}

describe("tearing a tab off into its own window", () => {
  it("writes the tab down under the new window's label before asking for the window", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const torn = useTabsStore.getState().activeTabId;

    act(() => result.current.tearOffTab(torn));

    const strip = readPersistedTabs(openedWindowLabel());
    expect(strip?.tabs.map((tab) => tab.id)).toEqual([torn]);
    expect(strip?.activeTabId).toBe(torn);
  });

  it("takes the tab out of this window", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const torn = useTabsStore.getState().activeTabId;

    act(() => result.current.tearOffTab(torn));

    expect(useTabsStore.getState().tabs.some((tab) => tab.id === torn)).toBe(false);
  });

  it("carries the tab's own filters across rather than opening a fresh one", () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const torn = useTabsStore.getState().activeTabId;
    act(() => {
      useTabsStore.getState().tabs[1]?.stores.filter.getState().setStatusMode("do");
    });

    act(() => result.current.tearOffTab(torn));

    expect(readPersistedTabs(openedWindowLabel())?.tabs[0]?.state.filter.statusMode).toBe("do");
  });

  it("refuses to tear off the only tab, which would move the window rather than divide it", () => {
    const { result } = renderHook(() => useTabCommands());
    const only = useTabsStore.getState().activeTabId;

    act(() => result.current.tearOffTab(only));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it("says why it refused rather than reading as a broken key", () => {
    const { result } = renderHook(() => useTabCommands());
    const tab = useTabsStore.getState().tabs[0];

    act(() => result.current.tearOffTab(tab?.id ?? ""));

    const toast = tab?.stores.mindmap.getState().pendingToast;
    expect(toast?.message).toContain("only tab");
    expect(toast?.message).toContain("leave the window empty");
  });

  it("gives the tab back when the window will not open", async () => {
    mockOpenWindow.mockRejectedValue(new Error("no windowing system"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const torn = useTabsStore.getState().activeTabId;

    await act(async () => {
      result.current.tearOffTab(torn);
      await Promise.resolve();
    });

    const { tabs } = useTabsStore.getState();
    expect(tabs).toHaveLength(2);
    expect(readPersistedTabs(openedWindowLabel())).toBeNull();
  });
});

describe("moving a tab into another window", () => {
  it("lets go of the tab before handing it over, so it is never in two windows", () => {
    // The send never settles: the removal must not wait on it. Waiting on it is what left the tab
    // in both windows when a drag between windows ended on WebKitGTK.
    mockSendTab.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const moved = useTabsStore.getState().activeTabId;

    act(() => result.current.moveTabToWindow(moved, "board-a"));

    expect(mockSendTab).toHaveBeenCalledWith("board-a", expect.objectContaining({ id: moved }));
    expect(useTabsStore.getState().tabs.some((tab) => tab.id === moved)).toBe(false);
  });

  it("does nothing for a tab this window no longer holds, and keeps the window open", () => {
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.moveTabToWindow("gone", "board-a"));

    expect(mockSendTab).not.toHaveBeenCalled();
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it("hands the tab over and then takes it out of this one", async () => {
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const moved = useTabsStore.getState().activeTabId;

    await act(async () => {
      result.current.moveTabToWindow(moved, "board-a");
      await Promise.resolve();
    });

    expect(mockSendTab).toHaveBeenCalledWith("board-a", expect.objectContaining({ id: moved }));
    expect(useTabsStore.getState().tabs.some((tab) => tab.id === moved)).toBe(false);
    expect(mockFocusWindow).toHaveBeenCalledWith("board-a");
  });

  it("closes this window when the tab it handed over was its last", async () => {
    const { result } = renderHook(() => useTabCommands());
    const only = useTabsStore.getState().activeTabId;

    await act(async () => {
      result.current.moveTabToWindow(only, "board-a");
      await Promise.resolve();
    });

    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });

  it("gives the tab back when the hand-over fails", async () => {
    mockSendTab.mockRejectedValue(new Error("no such window"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTabCommands());
    act(() => result.current.openTab());
    const moved = useTabsStore.getState().activeTabId;

    await act(async () => {
      result.current.moveTabToWindow(moved, "board-a");
      await Promise.resolve();
    });

    expect(useTabsStore.getState().tabs.some((tab) => tab.id === moved)).toBe(true);
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });
});

describe("opening a new window", () => {
  it("writes one tab down under a new label and asks for the window", () => {
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.openWindow());

    const strip = readPersistedTabs(openedWindowLabel());
    expect(strip?.tabs).toHaveLength(1);
    expect(strip?.activeTabId).toBe(strip?.tabs[0]?.id);
  });

  it("starts it where the current tab is looking, exactly as a new tab starts", () => {
    useTabsStore.getState().tabs[0]?.stores.mindmap.getState().enterSubtree("project-1");
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.openWindow());

    expect(readPersistedTabs(openedWindowLabel())?.tabs[0]?.state.subtreeRootId).toBe("project-1");
  });

  it("gives the new window fresh filters rather than the current tab's", () => {
    useTabsStore.getState().tabs[0]?.stores.filter.getState().setStatusMode("do");
    const { result } = renderHook(() => useTabCommands());

    act(() => result.current.openWindow());

    expect(readPersistedTabs(openedWindowLabel())?.tabs[0]?.state.filter.statusMode).toBe("all");
  });

  it("takes nothing out of this window", () => {
    const { result } = renderHook(() => useTabCommands());
    const before = useTabsStore.getState().tabs.length;

    act(() => result.current.openWindow());

    expect(useTabsStore.getState().tabs).toHaveLength(before);
  });

  it("leaves no orphaned strip behind when the window will not open", async () => {
    mockOpenWindow.mockRejectedValue(new Error("no windowing system"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTabCommands());

    await act(async () => {
      result.current.openWindow();
      await Promise.resolve();
    });

    expect(readPersistedTabs(openedWindowLabel())).toBeNull();
  });
});
