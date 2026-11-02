import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read as files: a CSS module imported into a test comes back as a class-name proxy.
const read = (path: string): string => readFileSync(path, "utf8");
const tokens = read("src/styles/tokens.css");
const phoneTopBar = read("src/components/PhoneTopBar/PhoneTopBar.module.css");
const bottomNav = read("src/components/BottomNav/BottomNav.module.css");
const bottomSheet = read("src/components/BottomSheet/BottomSheet.module.css");

describe("safe-area variables", () => {
  it("lets the inset pushed from Android win over env()", () => {
    expect(tokens).toMatch(/--safe-top:\s*max\(env\(safe-area-inset-top, 0px\), var\(--sat, 0px\)\)/);
    expect(tokens).toMatch(/--safe-bottom:\s*max\(env\(safe-area-inset-bottom, 0px\), var\(--sab, 0px\)\)/);
  });

  it("pads the phone top bar by the top inset, and keeps the bottom bars and corner square above the bottom one", () => {
    expect(phoneTopBar).toMatch(/padding-top:\s*var\(--safe-top\)/);
    expect(phoneTopBar).toMatch(/max\(var\(--corner-inset-br\), var\(--safe-bottom\)\)/);
    expect(bottomNav).toMatch(/padding-bottom:\s*var\(--safe-bottom\)/);
  });

  it("leaves no raw env() inset outside the token definitions", () => {
    for (const file of [phoneTopBar, bottomSheet, bottomNav]) expect(file).not.toContain("env(safe-area");
  });
});

describe("the display's rounded corner", () => {
  it("falls back to 16px, and the square sits at max(0.3 x radius, safe inset) + the margin", () => {
    expect(tokens).toMatch(/--corner-br:\s*16px/);
    expect(tokens).toMatch(/--corner-inset-br:\s*calc\(var\(--corner-br\) \* 0\.3\)/);
    expect(phoneTopBar).toMatch(/bottom:\s*calc\(var\(--space-2\) \+ max\(var\(--corner-inset-br\), var\(--safe-bottom\)\)\)/);
    expect(phoneTopBar).toMatch(/inset-inline-end:\s*calc\(var\(--space-2\) \+ max\(var\(--corner-inset-br\), var\(--safe-right\)\)\)/);
  });
});
