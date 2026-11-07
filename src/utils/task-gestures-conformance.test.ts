import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/task-gestures.json";
import { fail, record, str } from "@/test/conformance-board";
import type { StatusRefusal, StatusStep, VerdictPress } from "@/api/node-gestures";
import type { AgenticStatus, OrdinaryStatus, TaskStatus } from "@/api/tasks";
import type { Verdict } from "@/api/verdict";
import { AGENTIC_STATUS, TASK_STATUS, agentic, ordinary } from "@/utils/status-mapping";
import { altStep, nextStatus, statusAfter, verdictAfter } from "@/utils/task-gestures";
import type { StatusPrediction } from "@/utils/task-gestures";

/**
 * The status step, `Alt+Enter`, the Compound refusal and the verdict have two evaluators:
 * `tasks::rules::gestures`, which the writer performs, and `task-gestures.ts`, which the board uses
 * to show a press before the server answers it. `conformance/task-gestures.json` writes every case
 * down; `src-tauri/tests/operations/task_gestures_conformance.rs` is this file's other half.
 */

const ORDINARY: readonly OrdinaryStatus[] = Object.values(TASK_STATUS);
const AGENTIC: readonly AgenticStatus[] = Object.values(AGENTIC_STATUS);
const STEPS: readonly StatusStep[] = ["advance", "alt"];
const REFUSALS: readonly StatusRefusal[] = ["compound", "alt_enter_agentic_not_doing"];
const PRESSES: readonly VerdictPress[] = ["cycle", "kept", "broken"];
const VERDICTS: readonly Verdict[] = ["unresolved", "kept", "broken"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const text = str(value, what);
  return allowed.find((candidate) => candidate === text) ?? fail(`${what} is not one of ${allowed.join(", ")}: ${text}`);
}

function parseStatus(value: unknown, what: string): TaskStatus {
  const raw = record(value, what);
  const kind = str(raw.kind, `${what}.kind`);
  if (kind === "ordinary") return ordinary(oneOf(raw.status, ORDINARY, `${what}.status`));
  if (kind === "agentic") return agentic(oneOf(raw.status, AGENTIC, `${what}.status`));
  return fail(`${what}.kind is not a status model: ${kind}`);
}

function parseResult(value: unknown, what: string): StatusPrediction {
  const raw = record(value, what);
  const outcome = str(raw.outcome, `${what}.outcome`);
  if (outcome === "written") return { outcome, status: parseStatus(raw.status, `${what}.status`) };
  if (outcome === "refused") return { outcome, reason: oneOf(raw.reason, REFUSALS, `${what}.reason`) };
  return fail(`${what}.outcome is neither written nor refused: ${outcome}`);
}

function list(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

const top = record(corpusJson, "the corpus");

const nextCases = list(top.next_status, "`next_status`").map((value, index) => {
  const raw = record(value, `next_status[${index}]`);
  return { current: parseStatus(raw.current, `next_status[${index}].current`), next: parseStatus(raw.next, `next_status[${index}].next`) };
});

const altCases = list(top.alt_step, "`alt_step`").map((value, index) => {
  const raw = record(value, `alt_step[${index}]`);
  return { current: parseStatus(raw.current, `alt_step[${index}].current`), result: parseResult(raw.result, `alt_step[${index}].result`) };
});

const afterCases = list(top.status_after, "`status_after`").map((value, index) => {
  const raw = record(value, `status_after[${index}]`);
  if (typeof raw.compound !== "boolean") fail(`status_after[${index}].compound is not a boolean`);
  return {
    step: oneOf(raw.step, STEPS, `status_after[${index}].step`),
    current: parseStatus(raw.current, `status_after[${index}].current`),
    compound: raw.compound,
    result: parseResult(raw.result, `status_after[${index}].result`),
  };
});

const verdictCases = list(top.verdict_after, "`verdict_after`").map((value, index) => {
  const raw = record(value, `verdict_after[${index}]`);
  return {
    press: oneOf(raw.press, PRESSES, `verdict_after[${index}].press`),
    current: oneOf(raw.current, VERDICTS, `verdict_after[${index}].current`),
    verdict: oneOf(raw.verdict, VERDICTS, `verdict_after[${index}].verdict`),
  };
});

const name = (status: TaskStatus): string => `${status.kind} ${status.status}`;

describe("task gestures conformance corpus", () => {
  for (const testCase of nextCases) {
    it(`steps ${name(testCase.current)} to ${name(testCase.next)}`, () => {
      expect(nextStatus(testCase.current)).toEqual(testCase.next);
    });
  }

  for (const testCase of altCases) {
    it(`takes Alt+Enter on ${name(testCase.current)} as the corpus says`, () => {
      expect(altStep(testCase.current)).toEqual(testCase.result);
    });
  }

  for (const testCase of afterCases) {
    const compound = testCase.compound ? "a Compound" : "a";
    it(`takes ${testCase.step} on ${compound} ${name(testCase.current)} as the corpus says`, () => {
      expect(statusAfter(testCase.step, testCase.current, testCase.compound)).toEqual(testCase.result);
    });
  }

  for (const testCase of verdictCases) {
    it(`leaves ${testCase.verdict} after ${testCase.press} on ${testCase.current}`, () => {
      expect(verdictAfter(testCase.press, testCase.current)).toBe(testCase.verdict);
    });
  }

  it("has a case for every status and every press", () => {
    const statuses = [...ORDINARY.map(ordinary), ...AGENTIC.map(agentic)];
    for (const status of statuses) {
      expect(nextCases.some((c) => c.current.kind === status.kind && c.current.status === status.status)).toBe(true);
      expect(altCases.some((c) => c.current.kind === status.kind && c.current.status === status.status)).toBe(true);
      for (const step of STEPS) {
        for (const compound of [false, true]) {
          expect(afterCases.some((c) => c.step === step && c.compound === compound
            && c.current.kind === status.kind && c.current.status === status.status)).toBe(true);
        }
      }
    }
    for (const press of PRESSES) {
      for (const current of VERDICTS) {
        expect(verdictCases.some((c) => c.press === press && c.current === current)).toBe(true);
      }
    }
  });
});
