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
    expect(phoneTopBar).toContain("calc(var(--safe-bottom) + 12px)");
    expect(bottomNav).toMatch(/padding-bottom:\s*var\(--safe-bottom\)/);
  });

  it("leaves no raw env() inset outside the token definitions", () => {
    for (const file of [phoneTopBar, bottomSheet, bottomNav]) expect(file).not.toContain("env(safe-area");
  });
});

describe("the display's rounded corner", () => {
  it("falls back to 16px, and the square sits at max(0.3 x radius, safe or peek inset) + 12px, never under 20px", () => {
    expect(tokens).toMatch(/--corner-br:\s*16px/);
    expect(tokens).toMatch(/--corner-inset-br:\s*calc\(var\(--corner-br\) \* 0\.3\)/);
    expect(phoneTopBar).toContain(
      "inset-inline-end: max(calc(var(--corner-inset-br) + 12px), calc(var(--safe-right) + 12px), 20px);",
    );
    expect(phoneTopBar).toContain(
      "bottom: max(calc(var(--corner-inset-br) + 12px), calc(var(--safe-bottom) + 12px), calc(var(--peek-pad-bottom) + 12px), 20px);",
    );
  });
});

describe("Full screen's padding for the system bars", () => {
  const views = ["ListView", "PlanView", "StepsView", "ZenView"].map((v) => read(`src/components/${v}/${v}.module.css`));
  const mindmap = read("src/components/MindmapView/MindmapView.module.css");

  it("is 0 by default, the visible insets in full-screen Edge-to-edge, and the peek sizes (28px and 24px unknown) in full-screen Immersive", () => {
    expect(tokens).toMatch(/--peek-pad-top:\s*0px/);
    expect(tokens).toMatch(/--peek-pad-bottom:\s*0px/);
    expect(tokens).toMatch(
      /:root\[data-fs-bars="edgeToEdge"\]\s*\{\s*--peek-pad-top:\s*var\(--safe-top\);\s*--peek-pad-bottom:\s*var\(--safe-bottom\);/,
    );
    expect(tokens).toMatch(
      /:root\[data-fs-bars="immersive"\]\s*\{\s*--peek-pad-top:\s*max\(var\(--peek-top, 28px\), var\(--safe-top\)\);\s*--peek-pad-bottom:\s*max\(var\(--peek-bottom, 24px\), var\(--safe-bottom\)\);/,
    );
  });

  it("is added to the content box of every view but the Mindmap, phone overrides included", () => {
    for (const css of views) {
      expect(css).toContain("var(--peek-pad-top)");
      expect(css).toContain("var(--peek-pad-bottom)");
    }
    expect(views[0]).toContain(
      "padding: 0 var(--space-2) calc(var(--space-3) + var(--peek-pad-bottom));",
    );
    expect(views[1]).toContain(
      "padding: var(--space-2) var(--space-2) calc(var(--space-2) + var(--peek-pad-bottom));",
    );
    expect(mindmap).not.toContain("--peek-");
  });
});

describe("The List's sticky headers in full screen", () => {
  const list = read("src/components/ListView/ListView.module.css");
  const pathHeader = read("src/components/ListView/PathHeaderRow.module.css");

  it("keeps the plain top padding outside full screen and swaps in the inset only under data-fs-bars", () => {
    expect(list).toMatch(/\.container \{[^}]*padding: var\(--space-4\) var\(--space-4\)/);
    expect(list).toMatch(
      /:global\(:root\[data-fs-bars\]\) \.container \{\s*padding-top: var\(--peek-pad-top\);/,
    );
    expect(list).not.toContain("::before");
    for (const name of ["Zen", "Steps", "Plan"]) {
      const css = read(`src/components/${name}View/${name}View.module.css`);
      expect(css).toMatch(/\.container \{[^}]*padding: var\(--space-[24]\) var\(--space-[24]\)/);
      expect(css).toMatch(
        /:global\(:root\[data-fs-bars\]\) \.container \{\s*padding-top: var\(--peek-pad-top\);/,
      );
    }
  });

  it("sticks the path header at the content edge, and covers the inset above it only while stuck", () => {
    expect(pathHeader).toMatch(/position: sticky;[^}]*top: 0;[^}]*z-index: 1;/);
    expect(pathHeader).toMatch(/container-type: scroll-state;/);
    expect(pathHeader).toMatch(
      /@container scroll-state\(stuck: top\) \{\s*\.header::before \{[^}]*bottom: 100%;[^}]*height: var\(--peek-pad-top\);[^}]*background: var\(--canvas-bg\);/,
    );
  });

  it("reserves no bottom padding for the semi-transparent hot square", () => {
    expect(tokens).not.toContain("--peek-clear-bottom");
  });
});
