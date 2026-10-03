import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/task-status.json";
import { fail, record, str } from "@/test/conformance-board";
import type { AgenticStatus, OrdinaryStatus, TaskStatus } from "@/api/tasks";
import { AGENTIC_STATUS, TASK_STATUS, agentic, convertedStatus, ordinary } from "@/utils/status-mapping";

/**
 * The conversion between the two Task status models has two evaluators: `convertedStatus`, which
 * the Task editor uses to show the status a flag change would leave, and `Status::converted`, which
 * the writer performs. `conformance/task-status.json` writes every case down;
 * `src-tauri/tests/operations/task_status_conformance.rs` is this file's other half.
 */

const ORDINARY: readonly OrdinaryStatus[] = Object.values(TASK_STATUS);
const AGENTIC: readonly AgenticStatus[] = Object.values(AGENTIC_STATUS);

function parseStatus(value: unknown, what: string): TaskStatus {
  const raw = record(value, what);
  const kind = str(raw.kind, `${what}.kind`);
  const status = str(raw.status, `${what}.status`);
  if (kind === "ordinary") {
    return ordinary(ORDINARY.find((candidate) => candidate === status) ?? fail(`${what}.status is not ordinary`));
  }
  if (kind === "agentic") {
    return agentic(AGENTIC.find((candidate) => candidate === status) ?? fail(`${what}.status is not Agentic`));
  }
  return fail(`${what}.kind is not a status model: ${kind}`);
}

interface ConversionCase {
  status: TaskStatus;
  agentic: boolean;
  converted: TaskStatus | null;
}

function parseCase(value: unknown, index: number): ConversionCase {
  const raw = record(value, `cases[${index}]`);
  if (typeof raw.agentic !== "boolean") fail(`cases[${index}].agentic is not a boolean`);
  return {
    status: parseStatus(raw.status, `cases[${index}].status`),
    agentic: raw.agentic,
    converted: raw.converted === null ? null : parseStatus(raw.converted, `cases[${index}].converted`),
  };
}

const top = record(corpusJson, "the corpus");
const models = record(top.models, "`models`");
if (!Array.isArray(top.cases)) fail("`cases` is not an array");
const cases = top.cases.map(parseCase);

describe("task status conformance corpus", () => {
  it("lists each model's statuses as the frontend spells them", () => {
    expect(models.ordinary).toEqual([...ORDINARY]);
    expect([...(Array.isArray(models.agentic) ? models.agentic : [])].sort()).toEqual([...AGENTIC].sort());
  });

  for (const testCase of cases) {
    const into = testCase.agentic ? "Agentic" : "ordinary";
    it(`converts ${testCase.status.kind} ${testCase.status.status} into the ${into} model`, () => {
      expect(convertedStatus(testCase.status, testCase.agentic)).toEqual(testCase.converted);
    });
  }
});
