import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/zen-contents.json";
import type { CorpusNode } from "@/test/conformance-board";
import { dependencyEdges, fail, ids, parseNode, record, str, toMindmapNode } from "@/test/conformance-board";
import type { FilterState, StatusMode, TagFilterMode } from "@/utils/filter-tree";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { PillFilter } from "@/utils/list-filter";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import type { View } from "@/stores/use-view-store";
import { ALL_VIEWS } from "@/stores/use-view-store";
import { lockedStatusMode } from "@/utils/view-preset";
import type { ZenOptions } from "@/utils/zen-contents";
import { zenContents } from "@/utils/zen-contents";

/**
 * The Zen View's contents have two evaluators: `zen-contents.ts`, which the Zen View calls as it
 * renders, and `src-tauri/src/filters/zen.rs`. `conformance/zen-contents.json` holds them together;
 * `src-tauri/tests/operations/zen_contents_conformance.rs` is this file's other half.
 */

interface Drawn {
  tasks: string[];
  commitments: string[];
  expectations: string[];
}

interface ZenCase {
  name: string;
  board: string;
  shared: FilterState;
  options: ZenOptions;
  expect: Drawn;
}

const STATUS_MODES: readonly StatusMode[] = ["all", "plan", "start", "do", "backlog"];
const PILL_MODES: readonly TagFilterMode[] = ["any", "all", "exclude"];

function bool(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${what} is not a boolean`);
  return value;
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value;
}

function parsePill(value: unknown, what: string): PillFilter {
  const raw = record(value, what);
  const mode = str(raw.mode, `${what}.mode`);
  return {
    value: str(raw.value, `${what}.value`),
    mode: PILL_MODES.find((candidate) => candidate === mode) ?? fail(`${what}.mode is not a pill mode`),
  };
}

/** The tab's shared filter, with every unstated axis at the app's default. */
function parseShared(value: unknown, what: string): FilterState {
  const raw = record(value, what);
  const preset = str(raw.preset, `${what}.preset`);
  return {
    ...DEFAULT_FILTER,
    statusMode: STATUS_MODES.find((mode) => mode === preset) ?? fail(`${what}.preset is not a preset`),
    ...(raw.showOnAgent !== undefined ? { showOnAgent: bool(raw.showOnAgent, `${what}.showOnAgent`) } : {}),
    ...(raw.showReview !== undefined ? { showReview: bool(raw.showReview, `${what}.showReview`) } : {}),
    ...(raw.startHidesCheckedWaits !== undefined
      ? { startHidesCheckedWaits: bool(raw.startHidesCheckedWaits, `${what}.startHidesCheckedWaits`) }
      : {}),
    ...(raw.privateMode !== undefined ? { privateMode: bool(raw.privateMode, `${what}.privateMode`) } : {}),
  };
}

function parseOptions(value: unknown, what: string): ZenOptions {
  const raw = record(value, what);
  return {
    commitments: bool(raw.commitments, `${what}.commitments`),
    expectations: bool(raw.expectations, `${what}.expectations`),
    agentic: raw.agentic === undefined
      ? []
      : array(raw.agentic, `${what}.agentic`).map((pill, index) => parsePill(pill, `${what}.agentic[${index}]`)),
    showsStarted: bool(raw.showsStarted, `${what}.showsStarted`),
    showsCompound: bool(raw.showsCompound, `${what}.showsCompound`),
  };
}

function parseCase(value: unknown, index: number): ZenCase {
  const raw = record(value, `cases[${index}]`);
  const name = str(raw.name, `cases[${index}].name`);
  const drawn = record(raw.expect, `${name}.expect`);
  return {
    name,
    board: str(raw.board, `${name}.board`),
    shared: parseShared(raw.filter, `${name}.filter`),
    options: parseOptions(raw.options, `${name}.options`),
    expect: {
      tasks: ids(drawn.tasks, `${name}.expect.tasks`),
      commitments: ids(drawn.commitments, `${name}.expect.commitments`),
      expectations: ids(drawn.expectations, `${name}.expect.expectations`),
    },
  };
}

interface ViewCase {
  view: View;
  locked: StatusMode | null;
}

function parseView(value: unknown, index: number): ViewCase {
  const raw = record(value, `views[${index}]`);
  const view = str(raw.view, `views[${index}].view`);
  const locked = raw.locked === null ? null : str(raw.locked, `views[${index}].locked`);
  return {
    view: ALL_VIEWS.find((candidate) => candidate === view) ?? fail(`views[${index}].view is not a view`),
    locked: locked === null ? null : STATUS_MODES.find((mode) => mode === locked) ?? fail(`views[${index}].locked`),
  };
}

const top = record(corpusJson, "the corpus");
const cases = array(top.cases, "`cases`").map(parseCase);
const views = array(top.views, "`views`").map(parseView);
const boards: Record<string, CorpusNode> = Object.fromEntries(
  Object.entries(record(top.boards, "`boards`")).map(([name, board]) => [name, parseNode(board, `boards.${name}`)]),
);

describe("zen contents conformance corpus", () => {
  it("names every view once", () => {
    expect(views.map((testCase) => testCase.view).sort()).toEqual([...ALL_VIEWS].sort());
  });

  for (const testCase of views) {
    it(`the ${testCase.view} view locks ${testCase.locked ?? "no preset"}`, () => {
      expect(lockedStatusMode(testCase.view)).toBe(testCase.locked);
    });
  }

  for (const testCase of cases) {
    it(testCase.name, () => {
      const board = boards[testCase.board] ?? fail(`no board named ${testCase.board}`);
      const root = toMindmapNode(board);
      const source = {
        tasks: flattenTaskRows(root, dependencyEdges(board)),
        commitments: flattenCommitmentRows(root),
        expectations: flattenExpectationRows(root),
      };
      const drawn = zenContents(source, testCase.shared, testCase.options, null);
      expect({
        tasks: drawn.tasks.rows.map((row) => row.node.id),
        commitments: drawn.commitments.rows.map((row) => row.node.id),
        expectations: drawn.expectations.rows.map((row) => row.node.id),
      }).toEqual(testCase.expect);
    });
  }
});
