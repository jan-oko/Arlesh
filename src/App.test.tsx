import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { dir: () => "ltr" } }) }));
vi.mock("@/components/TopBar/TopBar", () => ({ default: () => <div data-testid="top-bar" /> }));
vi.mock("@/components/MindmapView/MindmapView", () => ({ default: () => <div data-testid="mindmap-view" /> }));
vi.mock("@/components/ListView/ListView", () => ({ default: () => <div data-testid="list-view" /> }));

beforeEach(() => {
  useViewStore.setState({ view: "mindmap" });
  useThemeStore.setState({ theme: "dark" });
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

  it("Alt+L toggles between views", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyL", altKey: true });
    expect(useViewStore.getState().view).toBe("list");
    fireEvent.keyDown(window, { code: "KeyL", altKey: true });
    expect(useViewStore.getState().view).toBe("mindmap");
  });

  it("does not toggle while typing in an input", () => {
    render(<App />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { code: "KeyL", altKey: true });
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
