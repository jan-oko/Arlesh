import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSystemBars } from "@/hooks/use-system-bars";
import { useDisplayStore } from "@/stores/use-display-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useThemeStore } from "@/stores/use-theme-store";

const setSystemBars = vi.fn();

beforeEach(() => {
  setSystemBars.mockClear();
  Reflect.set(window, "ArleshBars", { setSystemBars });
  useDisplayStore.setState({ systemBars: "edgeToEdge", systemBarsFullscreen: "immersive" });
  useFullscreenStore.setState({ isFullscreen: false });
  useThemeStore.setState({ theme: "dark" });
});
afterEach(() => {
  Reflect.deleteProperty(window, "ArleshBars");
});

describe("useSystemBars", () => {
  it("defaults to edge-to-edge in normal display and immersive in fullscreen", () => {
    const { systemBars, systemBarsFullscreen } = useDisplayStore.getInitialState();
    expect([systemBars, systemBarsFullscreen]).toEqual(["edgeToEdge", "immersive"]);
  });

  it("tells the activity the normal mode on mount", () => {
    renderHook(() => useSystemBars());
    expect(setSystemBars).toHaveBeenLastCalledWith("edgeToEdge", true);
  });

  it("applies the fullscreen mode inside fullscreen and restores the normal one on leaving", () => {
    renderHook(() => useSystemBars());
    act(() => useFullscreenStore.setState({ isFullscreen: true }));
    expect(setSystemBars).toHaveBeenLastCalledWith("immersive", true);
    act(() => useFullscreenStore.setState({ isFullscreen: false }));
    expect(setSystemBars).toHaveBeenLastCalledWith("edgeToEdge", true);
  });

  it("applies a changed setting live", () => {
    renderHook(() => useSystemBars());
    act(() => useDisplayStore.getState().setSystemBars("standard"));
    expect(setSystemBars).toHaveBeenLastCalledWith("standard", true);
  });

  it("follows the theme for the status-bar icons", () => {
    renderHook(() => useSystemBars());
    act(() => useThemeStore.setState({ theme: "light" }));
    expect(setSystemBars).toHaveBeenLastCalledWith("edgeToEdge", false);
  });

  it("does nothing without the Android bridge", () => {
    Reflect.deleteProperty(window, "ArleshBars");
    expect(() => renderHook(() => useSystemBars())).not.toThrow();
  });

  it("persists both settings", () => {
    act(() => useDisplayStore.getState().setSystemBarsFullscreen("standard"));
    const stored: unknown = JSON.parse(localStorage.getItem("arlesh-display") ?? "{}");
    expect(stored).toMatchObject({ state: { systemBars: "edgeToEdge", systemBarsFullscreen: "standard" } });
  });
});
