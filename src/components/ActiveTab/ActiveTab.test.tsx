import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ActiveTab from "./ActiveTab";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import { surfaceCommand } from "@/test/surface-command";
import { LONG_PRESS_MS } from "@/utils/touch/gestures";
import { PHONE_LAYOUT_QUERY, TOUCH_ONLY_QUERY, TOUCH_QUERY } from "@/hooks/use-media-query";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/TopBar/TopBar", () => ({ default: () => <div data-testid="top-bar" /> }));
vi.mock("@/components/PhoneTopBar/PhoneTopBar", () => ({ default: () => <div data-testid="phone-top-bar" /> }));
vi.mock("@/components/BottomChrome/BottomChrome", () => ({ default: () => <div data-testid="bottom-chrome" /> }));
vi.mock("@/components/CommandPalette/CommandPalette", () => ({ default: () => <div data-testid="palette" /> }));
vi.mock("@/components/MindmapView/MindmapView", () => ({ default: () => <div data-testid="mindmap-view" /> }));
vi.mock("@/hooks/use-global-hotkeys", () => ({ useGlobalHotkeys: () => undefined }));
vi.mock("@/hooks/use-tab-title", () => ({ useTabTitle: () => undefined }));
vi.mock("@/hooks/use-two-finger-preset", () => ({ useTwoFingerPreset: () => undefined }));

/** Pretends the platform matches exactly these media queries. */
function stubMedia(matching: readonly string[]): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matching.includes(query),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  stubMedia([TOUCH_QUERY, TOUCH_ONLY_QUERY, PHONE_LAYOUT_QUERY]);
  useFullscreenStore.setState({ isFullscreen: false });
  usePaletteStore.setState({ isOpen: false });
  useCommandSurfaceStore.setState({ tables: new Map(), revision: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ActiveTab on the phone in full screen", () => {
  it("shows the top bar and the bottom chrome normally, and no corner square", () => {
    render(<ActiveTab />);
    expect(screen.getByTestId("phone-top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-chrome")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "topBarSquare" })).not.toBeInTheDocument();
  });

  it("hides the top bar, the action bar and the bottom nav, leaving the hot square in the corner", () => {
    useFullscreenStore.setState({ isFullscreen: true });
    render(<ActiveTab />);
    expect(screen.queryByTestId("phone-top-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-chrome")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "topBarSquare" }).className).toContain("squareCorner");
    expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
  });

  it("the corner square taps to Open and long-presses to the palette, as the top bar's does", () => {
    vi.useFakeTimers();
    const open = surfaceCommand("global.openSearch", "openSearch");
    useCommandSurfaceStore.setState({ tables: new Map([["global", [open]]]), revision: 1 });
    useFullscreenStore.setState({ isFullscreen: true });
    render(<ActiveTab />);
    const square = screen.getByRole("button", { name: "topBarSquare" });
    fireEvent.pointerDown(square, { pointerId: 1 });
    fireEvent.pointerUp(square, { pointerId: 1 });
    expect(open.run).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(square, { pointerId: 2 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("brings everything back when full screen ends", () => {
    useFullscreenStore.setState({ isFullscreen: true });
    render(<ActiveTab />);
    act(() => { useFullscreenStore.getState().toggle(); });
    expect(screen.getByTestId("phone-top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-chrome")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "topBarSquare" })).not.toBeInTheDocument();
  });
});

describe("which layout shows follows touch, never width", () => {
  it("shows the touch layout on a wide touch-only screen, such as a phone in landscape", () => {
    stubMedia([TOUCH_QUERY, TOUCH_ONLY_QUERY]);
    render(<ActiveTab />);
    expect(screen.getByTestId("phone-top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-chrome")).toBeInTheDocument();
    expect(screen.queryByTestId("top-bar")).not.toBeInTheDocument();
  });

  it("shows the desktop layout in a narrow window with a mouse", () => {
    stubMedia([PHONE_LAYOUT_QUERY]);
    render(<ActiveTab />);
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-chrome")).not.toBeInTheDocument();
  });

  it("shows the desktop layout on a touch laptop, which also has a mouse", () => {
    stubMedia([TOUCH_QUERY]);
    render(<ActiveTab />);
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-chrome")).not.toBeInTheDocument();
  });
});
