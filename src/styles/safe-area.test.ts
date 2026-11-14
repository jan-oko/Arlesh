import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read as files: a CSS module imported into a test comes back as a class-name proxy.
const read = (path: string): string => readFileSync(path, "utf8");
const tokens = read("src/styles/tokens.css");
const phoneTopBar = read("src/components/PhoneTopBar/PhoneTopBar.module.css");
const bottomNav = read("src/components/BottomNav/BottomNav.module.css");
const app = read("src/App.module.css");
const bottomSheet = read("src/components/BottomSheet/BottomSheet.module.css");

describe("safe-area variables", () => {
  it("lets the inset pushed from Android win over env()", () => {
    expect(tokens).toMatch(/--safe-top:\s*max\(env\(safe-area-inset-top, 0px\), var\(--sat, 0px\)\)/);
    expect(tokens).toMatch(/--safe-bottom:\s*max\(env\(safe-area-inset-bottom, 0px\), var\(--sab, 0px\)\)/);
  });

  it("pads the phone top bar by the top inset, and keeps the bottom bars and corner square above the bottom one", () => {
    expect(phoneTopBar).toMatch(/padding-top:\s*var\(--safe-top\)/);
    expect(phoneTopBar).toContain("calc(var(--safe-bottom) + 12px)");
    expect(bottomNav).toMatch(/var\(--safe-bottom\) max\(/);
  });

  it("leaves no raw env() inset outside the token definitions", () => {
    for (const file of [phoneTopBar, bottomSheet, bottomNav]) expect(file).not.toContain("env(safe-area");
  });
});

describe("landscape side insets", () => {
  const topBar = read("src/components/TopBar/TopBar.module.css");
  const activeTab = read("src/components/ActiveTab/ActiveTab.module.css");

  it("leave the shell unpadded, so the bars' backgrounds and the Mindmap canvas reach the edge", () => {
    expect(app).not.toMatch(/padding-(left|right)/);
    expect(app).toMatch(/background:\s*var\(--canvas-bg\)/);
  });

  it("are not padded out of the bars: their buttons spread across the full width, cutout included", () => {
    for (const file of [topBar, bottomNav, read("src/components/ActionBar/ActionBar.module.css"), read("src/components/TabStrip/TabStrip.module.css")]) {
      expect(file).not.toContain("--safe-left");
      expect(file).not.toContain("--safe-right");
    }
  });

  it("has no whole-side padding for any view: each reaches the edge, and only a row the camera overlaps pads itself", () => {
    expect(activeTab).toMatch(/\.views \{/);
    expect(activeTab).not.toMatch(/padding\s*:/);
    for (const file of ["ListView/TaskRow", "ListView/PathHeaderRow", "PlanView/PlanTaskCard", "StepsView/StepCard"]) {
      expect(read(`src/components/${file}.module.css`)).toContain("var(--clear-left, 0px)");
    }
  });

  it("keeps the bars' ends clear of the corner's radius and of the camera, and nothing else", () => {
    // The top bar's content starts below the status bar, so a corner pads only by what is left of it.
    expect(phoneTopBar).toMatch(/max\(var\(--space-2\), calc\(\(var\(--corner-tl\) - var\(--safe-top\)\) \* 0\.3\), var\(--clear-left, 0px\)\)/);
    expect(phoneTopBar).toMatch(/max\(var\(--space-2\), calc\(\(var\(--corner-tr\) - var\(--safe-top\)\) \* 0\.3\), var\(--clear-right, 0px\)\)/);
    // The bottom navigation's content sits above the gesture inset, so a corner pads only by what is left of it.
    expect(bottomNav).toMatch(/max\(calc\(\(var\(--corner-br\) - var\(--safe-bottom\)\) \* 0\.3\), var\(--clear-right, 0px\)\) var\(--safe-bottom\) max\(calc\(\(var\(--corner-bl\) - var\(--safe-bottom\)\) \* 0\.3\), var\(--clear-left, 0px\)\)/);
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
    for (const css of views.slice(0, 3)) expect(css).toContain("var(--peek-pad-bottom)");
    for (const css of views.slice(0, 3)) expect(css).toContain("var(--peek-pad-top)");
    expect(views[0]).toContain(
      "padding: 0 var(--space-2) calc(var(--space-3) + var(--peek-pad-bottom));",
    );
    expect(views[1]).toContain(
      "padding: var(--space-2) var(--space-2) calc(var(--space-2) + var(--peek-pad-bottom));",
    );
    expect(mindmap).not.toContain("--peek-");
  });
});

describe("The shared bottom sheet", () => {
  const sheet = read("src/components/BottomSheet/BottomSheet.module.css");

  it("clears the safe inset, the gesture peek and the rounded corners, plus a gap, in every mode", () => {
    expect(sheet).toMatch(
      /\.sheet \{[^}]*padding-bottom: calc\(\s*max\(var\(--safe-bottom\), var\(--peek-pad-bottom, 0px\), calc\(max\(var\(--corner-bl\), var\(--corner-br\)\) \* 0\.3\)\) \+\s*var\(--space-6\)\s*\);/,
    );
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
    const zen = read("src/components/ZenView/ZenView.module.css");
    expect(zen).toMatch(/\.container \{[^}]*padding: var\(--space-4\) var\(--space-4\)/);
    // Every side the same sliver, the bottom included: the card runs to the bottom edge.
    expect(zen).toMatch(/:global\(:root\[data-fs-bars\]\) \.container \{[^}]*--zen-edge: 6px;[^}]*padding: var\(--zen-edge\);/);
    expect(zen).toContain("--zen-r-bl: max(0px, calc(var(--corner-bl) - var(--zen-edge)));");
    expect(zen).toMatch(/\.gridArea \{\s*border-radius: var\(--zen-r-tl\) var\(--zen-r-tr\) var\(--zen-r-br\) var\(--zen-r-bl\);/);
    expect(zen).not.toContain("--peek-pad-bottom)\n");
    // A card that touches a screen corner takes the device's radius for it, and its focus ring is inside the border.
    const card = read("src/components/ZenView/ZenTaskCard.module.css");
    for (const corner of ["tl", "tr", "br", "bl"]) expect(card).toContain(`.card[data-zen-corners~="${corner}"]`);
    expect(card).toMatch(/:global\(:root\[data-fs-bars\]\) \.cardSelected \{\s*box-shadow: inset 0 0 0 1px/);
    expect(card).toMatch(/border: 1px solid var\(--node-border\)/);
    // The strip of pills clears the corner and the camera like a row does.
    expect(read("src/components/ZenView/ZenStrip.module.css")).toContain("var(--clear-top, 0px) var(--clear-right, 0px) var(--space-1) var(--clear-left, 0px)");
    expect(zen).not.toContain("--peek-pad-top");
    for (const name of ["Steps", "Plan"]) {
      const css = read(`src/components/${name}View/${name}View.module.css`);
      expect(css).toMatch(/\.container \{[^}]*padding: var\(--space-[24]\) var\(--space-[24]\)/);
      expect(css).toMatch(
        /:global\(:root\[data-fs-bars\]\) \.container \{\s*padding-top: var\(--peek-pad-top\);/,
      );
    }
  });

  it("adds the phone's small top gap on the first section outside full screen only", () => {
    expect(list).toMatch(
      /:global\(:root:not\(\[data-fs-bars\]\)\) \.container > :first-child \{\s*padding-top: var\(--space-2\);/,
    );
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
