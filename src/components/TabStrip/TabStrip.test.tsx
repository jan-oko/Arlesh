import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
