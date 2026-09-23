import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TabStrip from "./TabStrip";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { freshTabState } from "@/stores/tab-persistence";
import { closeWindow, openBoardWindow } from "@/api/window";
import { claimTab, onTabClaimed, sendTabToWindow } from "@/api/board";
import type { TabClaim } from "@/api/board";
import { encodeTabDrag, TAB_DRAG_TYPE } from "@/utils/tab-drag";
import { TEAR_OFF_GRACE_MS } from "@/hooks/use-tab-tear-off";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi());
vi.mock("@/api/board", () => ({
  sendTabToWindow: vi.fn(() => Promise.resolve()),
  onBoardChanged: vi.fn(() => Promise.resolve(() => {})),
  onTabMoved: vi.fn(() => Promise.resolve(() => {})),
  claimTab: vi.fn(() => Promise.resolve()),
  onTabClaimed: vi.fn(() => Promise.resolve(() => {})),
}));

const mockCloseWindow = vi.mocked(closeWindow);
const mockOpenWindow = vi.mocked(openBoardWindow);
const mockSendTab = vi.mocked(sendTabToWindow);
const mockClaimTab = vi.mocked(claimTab);
const mockOnTabClaimed = vi.mocked(onTabClaimed);

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockCloseWindow.mockClear();
  mockOpenWindow.mockClear();
  mockSendTab.mockClear();
  mockClaimTab.mockClear();
  mockOnTabClaimed.mockClear();
});

/**
 * The drag's data, as the platform carries it between windows. jsdom has no `DataTransfer`, so this
 * is the part of one the strip uses: typed data, and the effect the drop settled on.
 */
class FakeDataTransfer {
  private readonly data = new Map<string, string>();
  dropEffect = "none";
  effectAllowed = "all";

  get types(): string[] {
    return [...this.data.keys()];
  }

  setData(type: string, value: string): void {
    this.data.set(type, value);
  }

  getData(type: string): string {
    return this.data.get(type) ?? "";
  }
}

/** A drag carrying a tab from another window, as the platform would deliver it here. */
function dragFromWindow(window: string, tabId: string): FakeDataTransfer {
  const dataTransfer = new FakeDataTransfer();
  dataTransfer.setData(TAB_DRAG_TYPE, encodeTabDrag({ tabId, window }));
  return dataTransfer;
}

/** A real mouse click with a given button — `fireEvent.click` cannot express a middle click. */
function clickWithButton(element: Element, button: number): void {
  fireEvent(element, new MouseEvent(button === 0 ? "click" : "auxclick", { button, bubbles: true }));
}

/** Opens a tab already labelled, since the label is normally written by the mounted view. */
function openLabelled(title: string, subtreeRootId: string): string {
  const id = useTabsStore.getState().openTab(freshTabState(subtreeRootId));
  useTabsStore.getState().setTabTitle(id, title);
  return id;
}

describe("the strip's labels", () => {
  it("names a tab after the subtree it is rooted at", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    expect(screen.getByRole("tab", { name: "CODE" })).toBeInTheDocument();
  });

  it("labels a tab showing the whole tree rather than leaving it nameless", () => {
    render(<TabStrip />);
    expect(screen.getByRole("tab", { name: "common:tabWholeTree" })).toBeInTheDocument();
  });
});

describe("switching tabs", () => {
  it("activates the tab that was clicked", () => {
    const first = useTabsStore.getState().tabs[0]?.id;
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    fireEvent.click(screen.getByRole("tab", { name: "common:tabWholeTree" }));

    expect(useTabsStore.getState().activeTabId).toBe(first);
  });

  it("marks the active tab as selected", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    expect(screen.getByRole("tab", { name: "CODE" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "common:tabWholeTree" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("opening and closing from the strip", () => {
  it("opens a tab from the + button", () => {
    render(<TabStrip />);
    fireEvent.click(screen.getByRole("button", { name: "common:newTab" }));
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("closes a tab from its ×", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    fireEvent.click(screen.getAllByRole("button", { name: "common:closeTab" })[1] ?? document.body);

    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("closes a tab on a middle click", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    clickWithButton(screen.getByRole("tab", { name: "CODE" }), 1);

    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("ignores a right click, which is not a close gesture", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    clickWithButton(screen.getByRole("tab", { name: "CODE" }), 2);

    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("closes the window rather than leaving an empty strip when the last tab is closed", () => {
    render(<TabStrip />);

    fireEvent.click(screen.getByRole("button", { name: "common:closeTab" }));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });
});

describe("reordering by drag", () => {
  it("drops a tab where it was released", () => {
    const moved = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const [firstTab, secondTab] = screen.getAllByRole("tab");
    const dataTransfer = new FakeDataTransfer();

    fireEvent.dragStart(secondTab?.parentElement ?? document.body, { dataTransfer });
    fireEvent.drop(firstTab?.parentElement ?? document.body, { dataTransfer });

    expect(useTabsStore.getState().tabs[0]?.id).toBe(moved);
  });

  it("carries the tab on the drag, since WebKitGTK never drops a drag that carries nothing", () => {
    const dragged = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const dataTransfer = new FakeDataTransfer();

    fireEvent.dragStart(screen.getByRole("tab", { name: "CODE" }).parentElement ?? document.body, { dataTransfer });

    expect(JSON.parse(dataTransfer.getData(TAB_DRAG_TYPE))).toEqual({ tabId: dragged, window: "main" });
  });

  it("neither tears off nor asks anyone for anything once the strip took the drop", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const [firstTab, secondTab] = screen.getAllByRole("tab");
    const dataTransfer = new FakeDataTransfer();

    fireEvent.dragStart(secondTab?.parentElement ?? document.body, { dataTransfer });
    fireEvent.drop(firstTab?.parentElement ?? document.body, { dataTransfer });
    dataTransfer.dropEffect = "move";
    fireEvent.dragEnd(secondTab?.parentElement ?? document.body, { dataTransfer });

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockClaimTab).not.toHaveBeenCalled();
  });

  it("leaves the order alone when what was dropped is not a tab", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const before = useTabsStore.getState().tabs.map((tab) => tab.id);
    const dataTransfer = new FakeDataTransfer();
    dataTransfer.setData("text/plain", "hello");

    fireEvent.drop(screen.getAllByRole("tab")[0]?.parentElement ?? document.body, { dataTransfer });

    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(before);
    expect(mockClaimTab).not.toHaveBeenCalled();
  });
});

/** Right-clicks a tab and picks an item from the menu that opens. */
function chooseFromMenu(tabName: string, item: string): void {
  const tab = screen.getByRole("tab", { name: tabName }).parentElement;
  fireEvent.contextMenu(tab ?? document.body);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** Types into the open rename field and presses a key. */
function typeName(value: string, key: string): void {
  const input = screen.getByRole("textbox", { name: "common:tabName" });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
}

describe("the tab context menu", () => {
  it("opens on a right click", () => {
    render(<TabStrip />);
    fireEvent.contextMenu(screen.getByRole("tab", { name: "common:tabWholeTree" }).parentElement ?? document.body);
    expect(screen.getByRole("menu", { name: "common:tabActions" })).toBeInTheDocument();
  });

  it("closes when the click lands outside it", () => {
    render(<TabStrip />);
    fireEvent.contextMenu(screen.getByRole("tab", { name: "common:tabWholeTree" }).parentElement ?? document.body);

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<TabStrip />);
    fireEvent.contextMenu(screen.getByRole("tab", { name: "common:tabWholeTree" }).parentElement ?? document.body);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the tab from its Close entry, exactly as the × does", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    chooseFromMenu("CODE", "common:closeTab");

    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("closes the window from Close rather than leaving an empty strip, as the × does", () => {
    render(<TabStrip />);

    chooseFromMenu("common:tabWholeTree", "common:closeTab");

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });
});

describe("renaming a tab", () => {
  it("puts the cursor in the field when the rename opens", async () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    chooseFromMenu("CODE", "common:renameTab");

    await waitFor(() => expect(screen.getByRole("textbox", { name: "common:tabName" })).toHaveFocus());
  });

  it("shows the name on Enter, in place of the derived label", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);

    chooseFromMenu("CODE", "common:renameTab");
    typeName("Today", "Enter");

    expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "CODE" })).not.toBeInTheDocument();
  });

  it("keeps the name when navigating republishes the derived label", () => {
    // The regression this feature is one wrong field away from: the label is rewritten from the
    // subtree descriptor whenever the tab is navigated, and a name kept in it would disappear then
    // — with nothing on screen to say why, and only after you had moved on.
    const id = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    chooseFromMenu("CODE", "common:renameTab");
    typeName("Today", "Enter");

    act(() => useTabsStore.getState().setTabTitle(id, "Bugfixes"));

    expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
  });

  it("leaves the name exactly as it was on Escape", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    chooseFromMenu("CODE", "common:renameTab");
    typeName("Today", "Enter");

    chooseFromMenu("Today", "common:renameTab");
    typeName("Something else", "Escape");

    expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
  });

  it("hands the tab back to its derived label when the name is cleared", () => {
    const id = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    chooseFromMenu("CODE", "common:renameTab");
    typeName("Today", "Enter");
    // The tab is navigated while it is wearing its name, so a stale label would show up here.
    act(() => useTabsStore.getState().setTabTitle(id, "Bugfixes"));

    chooseFromMenu("Today", "common:renameTab");
    typeName("  ", "Enter");

    expect(screen.getByRole("tab", { name: "Bugfixes" })).toBeInTheDocument();
  });

  it("commits what was typed when the field loses focus", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    chooseFromMenu("CODE", "common:renameTab");

    const input = screen.getByRole("textbox", { name: "common:tabName" });
    fireEvent.change(input, { target: { value: "Today" } });
    fireEvent.blur(input);

    expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
  });

  it("carries a long name in the tooltip, since the strip truncates the label itself", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const longName = "Everything left to do before the migration lands";

    chooseFromMenu("CODE", "common:renameTab");
    typeName(longName, "Enter");

    expect(screen.getByRole("tab", { name: longName })).toHaveAttribute("title", longName);
  });
});

describe("dragging a tab between windows", () => {
  /** Captures this window's claim listener, so a test can play the part of the other window. */
  function listenForClaims(): { claim: (claim: TabClaim) => void } {
    const heard: { claim: (claim: TabClaim) => void } = { claim: () => {} };
    mockOnTabClaimed.mockImplementation((onClaim) => {
      heard.claim = onClaim;
      return Promise.resolve(() => {});
    });
    return heard;
  }

  /** Drags the second tab out and ends the drag reporting `dropEffect`. Returns the tab's id. */
  function dragOut(dropEffect: string): string {
    const dragged = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const tab = screen.getByRole("tab", { name: "CODE" }).parentElement ?? document.body;
    const dataTransfer = new FakeDataTransfer();
    fireEvent.dragStart(tab, { dataTransfer });
    dataTransfer.dropEffect = dropEffect;
    fireEvent.dragEnd(tab, { dataTransfer });
    return dragged;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("becomes a window of its own when no window took it, though the drag still reports \"move\"", () => {
    // What GTK on Wayland reports after a drag released over the desktop: the last action agreed.
    vi.useFakeTimers();
    dragOut("move");
    expect(mockOpenWindow).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(TEAR_OFF_GRACE_MS));

    expect(mockOpenWindow).toHaveBeenCalledOnce();
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("moves to the window that asks for it, and is not torn off as well", async () => {
    vi.useFakeTimers();
    const heard = listenForClaims();
    const dragged = dragOut("move");
    await act(async () => { await Promise.resolve(); });

    act(() => heard.claim({ tabId: dragged, into: "board-a" }));
    act(() => vi.advanceTimersByTime(TEAR_OFF_GRACE_MS));

    expect(mockSendTab).toHaveBeenCalledWith("board-a", expect.objectContaining({ id: dragged }));
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it("is not torn off when the claim overtook the end of the drag", async () => {
    vi.useFakeTimers();
    const heard = listenForClaims();
    const dragged = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    await act(async () => { await Promise.resolve(); });
    const tab = screen.getByRole("tab", { name: "CODE" }).parentElement ?? document.body;
    const dataTransfer = new FakeDataTransfer();

    fireEvent.dragStart(tab, { dataTransfer });
    act(() => heard.claim({ tabId: dragged, into: "board-a" }));
    fireEvent.dragEnd(tab, { dataTransfer });
    act(() => vi.advanceTimersByTime(TEAR_OFF_GRACE_MS));

    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it("is not torn off when it was dropped on its own window's board", () => {
    vi.useFakeTimers();
    const dragged = openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const tab = screen.getByRole("tab", { name: "CODE" }).parentElement ?? document.body;
    const dataTransfer = new FakeDataTransfer();

    fireEvent.dragStart(tab, { dataTransfer });
    fireEvent.drop(document.body, { dataTransfer });
    fireEvent.dragEnd(tab, { dataTransfer });
    act(() => vi.advanceTimersByTime(TEAR_OFF_GRACE_MS));

    expect(JSON.parse(dataTransfer.getData(TAB_DRAG_TYPE))).toEqual({ tabId: dragged, window: "main" });
    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("asks the window a tab came from for it, when it is dropped anywhere on this one", () => {
    render(<TabStrip />);

    fireEvent.drop(document.body, { dataTransfer: dragFromWindow("board-a", "tab-9") });

    expect(mockClaimTab).toHaveBeenCalledWith("board-a", { tabId: "tab-9", into: "main" });
  });

  it("asks for it when it is dropped on the strip, and does not reorder anything", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const before = useTabsStore.getState().tabs.map((tab) => tab.id);

    fireEvent.drop(screen.getAllByRole("tab")[0]?.parentElement ?? document.body, {
      dataTransfer: dragFromWindow("board-a", "tab-9"),
    });

    expect(mockClaimTab).toHaveBeenCalledOnce();
    expect(mockClaimTab).toHaveBeenCalledWith("board-a", { tabId: "tab-9", into: "main" });
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(before);
  });

  it("does nothing with its own tab dropped off the strip, on its own board", () => {
    const own = openLabelled("CODE", "project-1");
    render(<TabStrip />);

    fireEvent.drop(document.body, { dataTransfer: dragFromWindow("main", own) });

    expect(mockClaimTab).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("accepts a dragged tab anywhere on the window, so that the source can tell it from the desktop", () => {
    render(<TabStrip />);
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: dragFromWindow("board-a", "tab-9") });

    document.body.dispatchEvent(over);

    expect(over.defaultPrevented).toBe(true);
  });

  it("hands a tab over when the window it was dropped on asks for it", async () => {
    const asked = openLabelled("CODE", "project-1");
    let answer: ((claim: TabClaim) => void) | null = null;
    mockOnTabClaimed.mockImplementation((onClaim) => {
      answer = onClaim;
      return Promise.resolve(() => {});
    });
    render(<TabStrip />);
    await waitFor(() => expect(answer).not.toBeNull());

    act(() => answer?.({ tabId: asked, into: "board-a" }));

    await waitFor(() => expect(mockSendTab).toHaveBeenCalledOnce());
    expect(mockSendTab.mock.calls[0]?.[0]).toBe("board-a");
  });
});
