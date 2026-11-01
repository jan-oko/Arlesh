import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/touch.json";
import { GESTURES, GESTURE_SCOPES } from "./gesture-list";

/** One row of the spec's gesture table, as `touch.md` writes it. */
function specRow(scopeName: string, gesture: string, does: string): string {
  return `| ${scopeName} | ${gesture} | ${does} |`;
}

describe("the gesture list", () => {
  const spec = readFileSync("docs/spec/touch.md", "utf8");

  it("is mirrored row for row by the table in docs/spec/touch.md", () => {
    for (const gesture of GESTURES) {
      const scope = GESTURE_SCOPES.find((entry) => entry.scope === gesture.scope);
      expect(scope).toBeDefined();
      const row = specRow(en[scope?.nameKey ?? "gestureScopeAll"], en[gesture.gestureKey], en[gesture.doesKey]);
      expect(spec, `touch.md is missing: ${row}`).toContain(row);
    }
  });

  it("has no more rows in the spec's table than in the list", () => {
    const rows = spec.split("\n").filter((line) => /^\| (Everywhere|Mindmap|List|Plan|Steps|Zen) \|/.test(line));
    expect(rows).toHaveLength(GESTURES.length);
  });

  it("gives every gesture a unique id", () => {
    expect(new Set(GESTURES.map((gesture) => gesture.id)).size).toBe(GESTURES.length);
  });

  it("lists the gestures the views agent changed", () => {
    const ids = GESTURES.map((gesture) => gesture.id);
    expect(ids).toEqual(expect.arrayContaining(["statusIcon", "listLeaf", "planScope", "planUp", "planMove"]));
  });
});
