import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCloseToTraySync, useQuit } from "./use-close-to-tray";
import { quitApp, setCloseToTray } from "@/api/tray";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";

vi.mock("@/api/tray", () => ({
  setCloseToTray: vi.fn(() => Promise.resolve()),
  quitApp: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useCloseToTrayStore.setState({ closeToTray: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCloseToTraySync", () => {
  it("tells the backend the stored setting on mount", async () => {
    renderHook(() => useCloseToTraySync());

    await waitFor(() => expect(setCloseToTray).toHaveBeenCalledWith(true));
  });

  it("tells the backend again when the setting is turned off", async () => {
    renderHook(() => useCloseToTraySync());
    await waitFor(() => expect(setCloseToTray).toHaveBeenCalledTimes(1));

    act(() => { useCloseToTrayStore.getState().setCloseToTray(false); });

    await waitFor(() => expect(setCloseToTray).toHaveBeenLastCalledWith(false));
  });

  it("does not push again when the setting is set to what it already was", async () => {
    renderHook(() => useCloseToTraySync());
    await waitFor(() => expect(setCloseToTray).toHaveBeenCalledTimes(1));

    act(() => { useCloseToTrayStore.getState().setCloseToTray(true); });

    expect(setCloseToTray).toHaveBeenCalledTimes(1);
  });

  it("logs a failed push instead of throwing, leaving the app usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(setCloseToTray).mockRejectedValueOnce(new Error("no backend"));

    renderHook(() => useCloseToTraySync());

    await waitFor(() => expect(warn).toHaveBeenCalled());
  });
});

describe("useQuit", () => {
  it("quits the app when called", async () => {
    const { result } = renderHook(() => useQuit());

    act(() => { result.current(); });

    await waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1));
  });

  it("is a stable callback across renders, so the binding table never reattaches", () => {
    const { result, rerender } = renderHook(() => useQuit());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("logs a refused quit rather than throwing into the keydown handler", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(quitApp).mockRejectedValueOnce(new Error("still here"));
    const { result } = renderHook(() => useQuit());

    act(() => { result.current(); });

    await waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
