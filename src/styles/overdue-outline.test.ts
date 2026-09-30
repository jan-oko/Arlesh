import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Read as files: a CSS module imported into a test comes back as a class-name proxy, `?raw` or not.
const read = (path: string): string => readFileSync(path, "utf8");
const shared = read("src/styles/overdue-outline.module.css");
const listRow = read("src/components/ListView/TaskRow.module.css");
const stepsCard = read("src/components/StepsView/StepCard.module.css");
const planCard = read("src/components/PlanView/PlanTaskCard.module.css");
const zenCard = read("src/components/ZenView/ZenTaskCard.module.css");

/** The body of the first rule in `css` whose selector is exactly `.name`. */
function rule(css: string, name: string): string {
  const match = new RegExp(`\\n\\.${name} \\{([^}]*)\\}`).exec(`\n${css}`);
  if (match?.[1] === undefined) throw new Error(`no .${name} rule`);
  return match[1];
}

/** Where `.name`'s rule starts in `css`. */
function at(css: string, name: string): number {
  return `\n${css}`.indexOf(`\n.${name} {`);
}

describe("the selected-and-Overdue outline", () => {
  it("is one variable, set by the shared Overdue class", () => {
    expect(rule(shared, "overdue")).toContain("--card-selection: var(--overdue-selected)");
  });

  const views: Array<[string, string, string, string]> = [
    ["List View row", listRow, "cardOverdue", "cardSelected"],
    ["Steps View card", stepsCard, "overdue", "selected"],
    ["Plan View card", planCard, "cardOverdue", "cardSelected"],
    ["Zen View card", zenCard, "cardOverdue", "cardSelected"],
  ];

  for (const [view, css, overdue, selected] of views) {
    it(`${view}: composes it, draws the amber border, and colours its selection from it`, () => {
      expect(rule(css, overdue)).toContain('composes: overdue from "@/styles/overdue-outline.module.css"');
      expect(rule(css, overdue)).toContain("border-color: var(--overdue)");
      expect(rule(css, selected)).toContain("border-color: var(--card-selection, var(--node-border-selected))");
      // The selection is declared after the Overdue class, so it wins where both apply.
      expect(at(css, selected)).toBeGreaterThan(at(css, overdue));
    });
  }
});
