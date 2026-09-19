import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TabStrip from "./TabStrip";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { freshTabState } from "@/stores/tab-persistence";
import { closeWindow } from "@/api/window";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/window", () => ({ closeWindow: vi.fn(() => Promise.resolve()) }));

const mockCloseWindow = vi.mocked(closeWindow);

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockCloseWindow.mockClear();
});

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

    fireEvent.dragStart(secondTab?.parentElement ?? document.body);
    fireEvent.drop(firstTab?.parentElement ?? document.body);

    expect(useTabsStore.getState().tabs[0]?.id).toBe(moved);
  });

  it("leaves the order alone when a drop arrives with nothing being dragged", () => {
    openLabelled("CODE", "project-1");
    render(<TabStrip />);
    const before = useTabsStore.getState().tabs.map((tab) => tab.id);

    fireEvent.drop(screen.getAllByRole("tab")[0]?.parentElement ?? document.body);

    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(before);
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
