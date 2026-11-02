import { describe, expect, it } from "vitest";
import { isSystemBarsMode, systemBarsFor } from "@/utils/system-bars";

describe("systemBarsFor", () => {
  it("reads the normal setting outside fullscreen and the fullscreen one inside it", () => {
    const settings = { systemBars: "edgeToEdge", systemBarsFullscreen: "immersive" } as const;
    expect(systemBarsFor(false, settings)).toBe("edgeToEdge");
    expect(systemBarsFor(true, settings)).toBe("immersive");
  });
  it("recognises only the three modes", () => {
    expect(isSystemBarsMode("standard")).toBe(true);
    expect(isSystemBarsMode("sticky")).toBe(false);
  });
});
