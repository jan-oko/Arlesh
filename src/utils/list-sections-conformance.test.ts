import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/list-sections.json";
import type { CorpusNode } from "@/test/conformance-board";
import { dependencyEdges, fail, ids, parseNode, record, str, toMindmapNode } from "@/test/conformance-board";
import type { FilterState, StatusMode } from "@/utils/filter-tree";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { ListFilterState } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import type { ListRowEntry, MixedListRow } from "@/utils/list-data";
import {
  flattenCommitmentRows, flattenExpectationRows, flattenTaskRows, mergeInTreeOrder, preOrderIndex,
} from "@/utils/list-data";
import type { ListSections } from "@/utils/list-sections";
import { showsOverdueSection, showsReviewSection, withListSections } from "@/utils/list-sections";

/**
 * The List View's lifted sections have two evaluators: `list-sections.ts`, which the List View calls
 * as it renders, and `src-tauri/src/filters/sections.rs`. `conformance/list-sections.json` holds them
 * together; `src-tauri/tests/operations/list_sections_conformance.rs` is this file's other half.
 */

/** Each drawn section's rows, in order, and the rest; a section that draws nothing is absent. */
interface Parts {
  review?: string[];
  overdue?: string[];
  asynchronous?: string[];
  rest: string[];
}

interface SectionsCase {
  name: string;
  board: string;
  sections: ListSections;
  rows?: string[];
  expect: Parts;
}

interface DrawnCase {
  name: string;
  preset: StatusMode;
  unblock: boolean;
  expectations: boolean;
  overdueSetting: boolean;
  review: boolean;
  overdue: boolean;
}

const STATUS_MODES: readonly StatusMode[] = ["all", "plan", "start", "do", "backlog"];

function bool(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${what} is not a boolean`);
  return value;
}

function parseParts(value: unknown, what: string): Parts {
  const raw = record(value, what);
  return {
    rest: ids(raw.rest, `${what}.rest`),
    ...(raw.review !== undefined ? { review: ids(raw.review, `${what}.review`) } : {}),
    ...(raw.overdue !== undefined ? { overdue: ids(raw.overdue, `${what}.overdue`) } : {}),
    ...(raw.asynchronous !== undefined ? { asynchronous: ids(raw.asynchronous, `${what}.asynchronous`) } : {}),
  };
}

function parseSectionsCase(value: unknown, index: number): SectionsCase {
  const raw = record(value, `cases[${index}]`);
  const name = str(raw.name, `cases[${index}].name`);
  const sections = record(raw.sections, `${name}.sections`);
  return {
    name,
    board: str(raw.board, `${name}.board`),
    sections: {
      review: bool(sections.review, `${name}.sections.review`),
      overdue: bool(sections.overdue, `${name}.sections.overdue`),
      asynchronous: bool(sections.asynchronous, `${name}.sections.asynchronous`),
    },
    ...(raw.rows !== undefined ? { rows: ids(raw.rows, `${name}.rows`) } : {}),
    expect: parseParts(raw.expect, `${name}.expect`),
  };
}

function parseDrawnCase(value: unknown, index: number): DrawnCase {
  const raw = record(value, `drawn[${index}]`);
  const name = str(raw.name, `drawn[${index}].name`);
  const filter = record(raw.filter, `${name}.filter`);
  const preset = str(filter.preset, `${name}.filter.preset`);
  return {
    name,
    preset: STATUS_MODES.find((mode) => mode === preset) ?? fail(`${name}.filter.preset is not a preset`),
    unblock: bool(filter.unblock, `${name}.filter.unblock`),
    expectations: bool(filter.expectations, `${name}.filter.expectations`),
    overdueSetting: bool(raw.overdueSetting, `${name}.overdueSetting`),
    review: bool(raw.review, `${name}.review`),
    overdue: bool(raw.overdue, `${name}.overdue`),
  };
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value;
}

const top = record(corpusJson, "the corpus");
const cases = array(top.cases, "`cases`").map(parseSectionsCase);
const drawn = array(top.drawn, "`drawn`").map(parseDrawnCase);
const boards: Record<string, CorpusNode> = Object.fromEntries(
  Object.entries(record(top.boards, "`boards`")).map(([name, board]) => [name, parseNode(board, `boards.${name}`)]),
);

/** A board's rows of every kind, in the order the tree draws them. */
function rowsOf(board: CorpusNode): MixedListRow[] {
  const root = toMindmapNode(board);
  const rows: MixedListRow[] = [
    ...flattenTaskRows(root, dependencyEdges(board)).map((row) => ({ type: "task" as const, row })),
    ...flattenCommitmentRows(root).map((row) => ({ type: "commitment" as const, row })),
    ...flattenExpectationRows(root).map((row) => ({ type: "expectation" as const, row })),
  ];
  return mergeInTreeOrder(rows, preOrderIndex(root));
}

/** Reads the drawn stream back into its parts: each heading opens a section, its closing rule ends it. */
function partsOf(entries: readonly ListRowEntry[]): Parts {
  const parts: Parts = { rest: [] };
  let current: string[] = parts.rest;
  for (const entry of entries) {
    switch (entry.type) {
      case "review":
        current = parts.review = [];
        break;
      case "overdue":
        current = parts.overdue = [];
        break;
      case "asynchronous":
        current = parts.asynchronous = [];
        break;
      case "reviewEnd":
      case "overdueEnd":
      case "asynchronousEnd":
        current = parts.rest;
        break;
      case "path":
        break;
      default:
        current.push(entry.row.node.id);
    }
  }
  return parts;
}

describe("list sections conformance corpus", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const board = boards[testCase.board] ?? fail(`no board named ${testCase.board}`);
      const kept = testCase.rows;
      const rows = rowsOf(board).filter((mixed) => kept === undefined || kept.includes(mixed.row.node.id));
      expect(partsOf(withListSections(rows, testCase.sections))).toEqual(testCase.expect);
    });
  }

  for (const testCase of drawn) {
    it(testCase.name, () => {
      const shared: FilterState = { ...DEFAULT_FILTER, statusMode: testCase.preset };
      const listFilter: ListFilterState = {
        ...DEFAULT_LIST_FILTER,
        preset: testCase.unblock ? "unblock" : testCase.expectations ? "expectations" : testCase.preset,
      };
      expect(showsReviewSection(shared, listFilter)).toBe(testCase.review);
      expect(showsOverdueSection(testCase.overdueSetting, shared, listFilter)).toBe(testCase.overdue);
    });
  }
});
