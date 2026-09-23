import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { GOAL_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import { VERDICT_VALUES } from "@/api/verdict";

/**
 * Pins the enumerable claims the glossary makes against the constants the app runs on.
 *
 * These are the claims that drifted: CONTEXT.md gave Project status as active / paused / completed /
 * archived for months while the code said active / achieved / frozen / archived. Prose cannot be
 * tested, but a list of values can. The Rust side is pinned by
 * `src-tauri/tests/structure/documented_vocabularies.rs`, which also checks the seeded Aspects.
 */

// Vitest runs from the project root.
const context = readFileSync("CONTEXT.md", "utf8");

/** The backticked values on the glossary line that opens with `**{label}:**`, in order. */
function documentedValues(label: string): string[] {
  const line = context.split("\n").find((l) => l.startsWith(`**${label}:**`));
  if (line === undefined) throw new Error(`CONTEXT.md has no "${label}" line`);
  return [...line.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? "");
}

describe("CONTEXT.md status vocabularies", () => {
  it("lists the Task statuses status-mapping.ts defines", () => {
    expect(documentedValues("Task status")).toEqual(Object.values(TASK_STATUS));
  });

  it("lists the Goal statuses status-mapping.ts defines", () => {
    expect(documentedValues("Goal status")).toEqual(Object.values(GOAL_STATUS));
  });

  it("lists the Project statuses status-mapping.ts defines", () => {
    expect(documentedValues("Project status")).toEqual(Object.values(PROJECT_STATUS));
  });

  it("lists the Commitment verdicts the app records", () => {
    expect(documentedValues("Commitment verdict")).toEqual([...VERDICT_VALUES]);
  });
});
