import { describe, it, expect, beforeEach } from "vitest";
import { useFullscreenStore } from "./use-fullscreen-store";

beforeEach(() => {
  localStorage.clear();
  useFullscreenStore.setState({ isFullscreen: false });
});

describe("useFullscreenStore", () => {
  it("starts with the chrome showing", () => {
    expect(useFullscreenStore.getState().isFullscreen).toBe(false);
  });

  it("toggling once hides the chrome, and again brings it back", () => {
    useFullscreenStore.getState().toggle();
    expect(useFullscreenStore.getState().isFullscreen).toBe(true);
    useFullscreenStore.getState().toggle();
    expect(useFullscreenStore.getState().isFullscreen).toBe(false);
  });

  it("writes nothing to storage, so a restart always comes back with the chrome", () => {
    useFullscreenStore.getState().toggle();
    expect(useFullscreenStore.getState().isFullscreen).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});
