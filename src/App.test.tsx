import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { closeWindow } from "@/api/window";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";

vi.mock("@/components/TopBar/TopBar", () => ({ default: () => <div data-testid="top-bar" /> }));
vi.mock("@/components/MindmapView/MindmapView", () => ({ default: () => <div data-testid="mindmap-view" /> }));
vi.mock("@/components/ListView/ListView", () => ({ default: () => <div data-testid="list-view" /> }));
vi.mock("@/components/PlanView/PlanView", () => ({ default: () => <div data-testid="plan-view" /> }));
vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi());

const mockCloseWindow = vi.mocked(closeWindow);

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockCloseWindow.mockClear();
  useViewStore.setState({ view: "mindmap" });
  useThemeStore.setState({ theme: "dark" });
  useFullscreenStore.setState({ isFullscreen: false });
  useHotkeysStore.setState({ isOpen: false });
  document.documentElement.removeAttribute("data-theme");
});

describe("App", () => {
  it("renders the Mindmap view by default", () => {
    render(<App />);
    expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("list-view")).not.toBeInTheDocument();
  });

  it("renders the List view once the store switches to it", () => {
    useViewStore.setState({ view: "list" });
    render(<App />);
    expect(screen.getByTestId("list-view")).toBeInTheDocument();
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
  });

  it("renders the Plan view once the store switches to it", () => {
    useViewStore.setState({ view: "plan" });
    render(<App />);
    expect(screen.getByTestId("plan-view")).toBeInTheDocument();
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
  });

  // One chord per view, not a cycle: Ctrl+L names the List and says nothing about where you were.
  it("Ctrl+L shows the List and leaves it showing when pressed again", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyL", ctrlKey: true });
    expect(useViewStore.getState().view).toBe("list");
    fireEvent.keyDown(window, { code: "KeyL", ctrlKey: true });
    expect(useViewStore.getState().view).toBe("list");
  });

  it("Ctrl+M shows the Mindmap from wherever you were", () => {
    useViewStore.setState({ view: "list" });
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyM", ctrlKey: true });
    expect(useViewStore.getState().view).toBe("mindmap");
  });

  it("Ctrl+P shows the Plan view", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyP", ctrlKey: true });
    expect(useViewStore.getState().view).toBe("plan");
  });

  // The dispatcher returns early on a typing target, so a save or print reflex inside a rename box
  // or an editor field is still just a reflex — it never reaches the switcher. Worth pinning:
  // Ctrl+S and Ctrl+P are exactly what someone will try while a field has the keyboard.
  it.each([
    { code: "KeyL", name: "Ctrl+L" },
    { code: "KeyP", name: "Ctrl+P" },
    { code: "KeyS", name: "Ctrl+S" },
  ])("does not switch views on $name while typing in an input", ({ code }) => {
    render(<App />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { code, ctrlKey: true });
    expect(useViewStore.getState().view).toBe("mindmap");
    document.body.removeChild(input);
  });

  it("applies the current theme to the document root", () => {
    useThemeStore.setState({ theme: "light" });
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("updates the document root when the theme changes", () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => useThemeStore.setState({ theme: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

/**
 * The tab chords are declared in the registry like every other binding, and dispatched at the app
 * level so they stay live regardless of which view — or modal — is on screen.
 */
describe("tab shortcuts", () => {
  it("Ctrl+T opens a tab", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("Ctrl+T opens the tab at the current subtree root", () => {
    render(<App />);
    act(() => { useTabsStore.getState().tabs[0]?.stores.mindmap.getState().enterSubtree("project-1"); });
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    expect(useTabsStore.getState().tabs[1]?.stores.mindmap.getState().subtreeRootId).toBe("project-1");
  });

  it("Ctrl+W closes the active tab", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    fireEvent.keyDown(window, { code: "KeyW", ctrlKey: true });
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it("Ctrl+W on the last tab closes the window instead of emptying the strip", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyW", ctrlKey: true });
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });

  it("Ctrl+Tab and Ctrl+Shift+Tab cycle between tabs", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    const ids = useTabsStore.getState().tabs.map((tab) => tab.id);

    fireEvent.keyDown(window, { code: "Tab", ctrlKey: true });
    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);

    fireEvent.keyDown(window, { code: "Tab", ctrlKey: true, shiftKey: true });
    expect(useTabsStore.getState().activeTabId).toBe(ids[1]);
  });

  it("Ctrl+1 jumps to the first tab", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    const ids = useTabsStore.getState().tabs.map((tab) => tab.id);

    fireEvent.keyDown(window, { code: "Digit1", ctrlKey: true });

    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);
  });

  it("stays live while the cheat-sheet is open, unlike a view binding", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "Slash", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });

    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("Ctrl+Shift+/ both opens the cheat-sheet and closes it again", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "Slash", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "Slash", ctrlKey: true, shiftKey: true });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the board alone (fullscreen)", () => {
  it("normally shows both rows of chrome above the board", () => {
    render(<App />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
  });

  it("F11 hides the tab strip and the top bar, leaving the view", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "F11" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("top-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
  });

  it("F11 again brings both back", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "F11" });
    fireEvent.keyDown(window, { code: "F11" });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
  });

  it("tab shortcuts stay live with the strip hidden — the bindings never depended on it", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "F11" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const before = useTabsStore.getState().tabs.length;
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    expect(useTabsStore.getState().tabs).toHaveLength(before + 1);
  });

  it("is not remembered: a fresh mount comes back with the chrome showing", () => {
    const first = render(<App />);
    fireEvent.keyDown(window, { code: "F11" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    first.unmount();

    // What a restart actually restores: whatever was persisted. The mode deliberately is not.
    useFullscreenStore.setState({ isFullscreen: false });
  useHotkeysStore.setState({ isOpen: false });
    render(<App />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});
