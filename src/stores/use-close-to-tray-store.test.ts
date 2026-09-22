import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLOSE_TO_TRAY, mergeCloseToTray, useCloseToTrayStore } from "./use-close-to-tray-store";

function freshStore() {
  return { ...useCloseToTrayStore.getState(), closeToTray: DEFAULT_CLOSE_TO_TRAY };
}

beforeEach(() => {
  useCloseToTrayStore.setState({ closeToTray: DEFAULT_CLOSE_TO_TRAY });
});

describe("default", () => {
  it("closes to the tray, so the MCP endpoint survives a close nobody configured", () => {
    expect(useCloseToTrayStore.getState().closeToTray).toBe(true);
  });
});

describe("setCloseToTray", () => {
  it("when set to false, the close button means quit again", () => {
    useCloseToTrayStore.getState().setCloseToTray(false);
    expect(useCloseToTrayStore.getState().closeToTray).toBe(false);
  });
});

describe("toggleCloseToTray", () => {
  it("when toggled twice, returns to closing to the tray", () => {
    useCloseToTrayStore.getState().toggleCloseToTray();
    expect(useCloseToTrayStore.getState().closeToTray).toBe(false);
    useCloseToTrayStore.getState().toggleCloseToTray();
    expect(useCloseToTrayStore.getState().closeToTray).toBe(true);
  });
});

describe("mergeCloseToTray", () => {
  it("when the stored value is false, keeps it", () => {
    expect(mergeCloseToTray({ closeToTray: false }, freshStore()).closeToTray).toBe(false);
  });

  it("when nothing was stored, falls back to the default", () => {
    expect(mergeCloseToTray(null, freshStore()).closeToTray).toBe(true);
  });

  it("when the stored blob is not an object, falls back to the default", () => {
    expect(mergeCloseToTray("close-to-tray", freshStore()).closeToTray).toBe(true);
  });

  it("when the stored blob has no such field, falls back to the default", () => {
    expect(mergeCloseToTray({ theme: "light" }, freshStore()).closeToTray).toBe(true);
  });

  it("when the stored value is not a boolean, falls back to the default rather than reading it as falsy", () => {
    expect(mergeCloseToTray({ closeToTray: "no" }, freshStore()).closeToTray).toBe(true);
    expect(mergeCloseToTray({ closeToTray: 0 }, freshStore()).closeToTray).toBe(true);
    expect(mergeCloseToTray({ closeToTray: null }, freshStore()).closeToTray).toBe(true);
  });

  it("keeps the store's own actions, which a stored blob never carries", () => {
    const merged = mergeCloseToTray({ closeToTray: false }, freshStore());
    expect(typeof merged.toggleCloseToTray).toBe("function");
    expect(typeof merged.setCloseToTray).toBe("function");
  });
});
