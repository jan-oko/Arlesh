import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "./use-theme-store";

beforeEach(() => {
  useThemeStore.setState({ theme: "dark" });
});

describe("default", () => {
  it("defaults to dark", () => {
    expect(useThemeStore.getState().theme).toBe("dark");
  });
});

describe("setTheme", () => {
  it("sets the active theme", () => {
    useThemeStore.getState().setTheme("light");
    expect(useThemeStore.getState().theme).toBe("light");
  });
});

describe("toggleTheme", () => {
  it("toggles between dark and light", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
  });
});
