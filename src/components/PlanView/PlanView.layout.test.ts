import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the phone Plan View's layout", () => {
  it("shares the height between the two panes equally", () => {
    // jsdom applies no CSS Modules rules, so the stylesheet is held to the spec's 50/50 directly.
    const css = readFileSync("src/components/PlanView/PlanView.module.css", "utf8");
    const phone = css.slice(css.indexOf("@media (max-width: 699.98px)"));
    expect(phone).toContain("grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);");
    expect(phone).not.toContain("2fr");
  });
});
