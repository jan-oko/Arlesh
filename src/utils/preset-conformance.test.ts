import { describe, expect, it } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import corpusJson from "@conformance/preset-filters.json";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";
import type { FilterState, ArchivedMode, StatusMode, TagFilter, TagFilterMode } from "@/utils/filter-tree";
import { DEFAULT_FILTER, filterTree } from "@/utils/filter-tree";
import type { ListFilterState, ListPreset } from "@/utils/list-filter";
import {
  DEFAULT_LIST_FILTER, filterCommitmentList, filterExpectationList, filterTaskList, isListPreset,
} from "@/utils/list-filter";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import type { Timing } from "@/api/scope-lifecycle";
import type { Verdict } from "@/api/verdict";
import { VERDICT_VALUES } from "@/api/verdict";

/**
 * The status presets have two evaluators: these predicates, which the Mindmap and the List View
 * call synchronously as they render, and `src-tauri/src/filters/`, which answers the MCP server.
 * Neither can call the other — a Tauri round trip in front of every selection move would be a
 * regression, and the backend assembles no node tree — so what keeps them from drifting is this:
 * a corpus of boards, filters and verdicts that **both** replay.
 *
 * `src-tauri/tests/operations/preset_conformance.rs` is this file's other half. Change a rule on
 * one side only and the other side fails on the case it broke.
 *
 * The corpus is not generated from either implementation. It is the specification written as data,
 * with each case naming the sentence it comes from.
 */

/** One node of a corpus board: the facts a filter reads, and nothing else. */
interface CorpusNode {
  id: string;
  kind: NodeKind;
  status?: string;
  timing?: Timing;
  planTiming?: Timing;
  archived?: boolean;
  backlogged?: boolean;
  verdict?: Verdict;
  isPrivate?: boolean;
  isBlocked?: boolean;
  isHabitFlow?: boolean;
  isHabitOccurrence?: boolean;
  delegated?: boolean;
  hasCheck?: boolean;
  tagIds?: number[];
  children?: CorpusNode[];
}

/** One corpus filter. Every field but `preset` defaults, exactly as the persisted filter does. */
interface CorpusFilter {
  preset: ListPreset;
  unblock?: boolean;
  expectations?: boolean;
  includeFlows?: boolean;
  tags?: TagFilter[];
  showInfo?: boolean;
  showFlow?: boolean;
  privateMode?: boolean;
  archived?: ArchivedMode;
  backlog?: ArchivedMode;
}

/** One case: a board, a filter, and what each of the three surfaces keeps. */
interface CorpusCase {
  name: string;
  spec: string;
  filter: CorpusFilter;
  board: string;
  mindmap: string[];
  list: string[];
  commitments: string[];
  /** The Expectation rows the List View keeps — empty on a board with none. */
  expectations: string[];
}

interface Corpus {
  cases: CorpusCase[];
  boards: Record<string, CorpusNode>;
}

function fail(what: string): never {
  throw new Error(`conformance/preset-filters.json: ${what}`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return { ...value };
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} is not a string`);
  return value;
}

function optionalBool(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${what} is not a boolean`);
  return value;
}

function ids(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value.map((entry, index) => str(entry, `${what}[${index}]`));
}

function parseNode(value: unknown, what: string): CorpusNode {
  const raw = record(value, what);
  const id = str(raw.id, `${what}.id`);
  const kind = str(raw.kind, `${what}.kind`);
  if (!isNodeKind(kind)) fail(`${what}.kind is not a node kind: ${kind}`);
  const children = raw.children === undefined
    ? []
    : (Array.isArray(raw.children) ? raw.children : fail(`${what}.children is not an array`))
      .map((child, index) => parseNode(child, `${what}.children[${index}]`));
  return {
    id,
    kind,
    children,
    ...(raw.status !== undefined ? { status: str(raw.status, `${what}.status`) } : {}),
    ...(raw.timing !== undefined ? { timing: parseTiming(raw.timing, `${what}.timing`) } : {}),
    ...(raw.planTiming !== undefined ? { planTiming: parseTiming(raw.planTiming, `${what}.planTiming`) } : {}),
    ...(raw.verdict !== undefined ? { verdict: parseVerdict(raw.verdict, `${what}.verdict`) } : {}),
    ...(raw.tagIds !== undefined ? { tagIds: parseTagIds(raw.tagIds, `${what}.tagIds`) } : {}),
    ...flag(raw.archived, "archived", what),
    ...flag(raw.backlogged, "backlogged", what),
    ...flag(raw.isPrivate, "isPrivate", what),
    ...flag(raw.isBlocked, "isBlocked", what),
    ...flag(raw.isHabitFlow, "isHabitFlow", what),
    ...flag(raw.isHabitOccurrence, "isHabitOccurrence", what),
    ...flag(raw.delegated, "delegated", what),
    ...flag(raw.hasCheck, "hasCheck", what),
  };
}

function flag(value: unknown, name: string, what: string): Record<string, boolean> {
  const parsed = optionalBool(value, `${what}.${name}`);
  return parsed === undefined ? {} : { [name]: parsed };
}

const TIMINGS: readonly string[] = ["pending", "active", "lapsed"];

function parseTiming(value: unknown, what: string): Timing {
  const timing = str(value, what);
  if (!TIMINGS.includes(timing)) fail(`${what} is not a timing: ${timing}`);
  // Narrowed by the membership check above; the union has no runtime form to test against.
  return TIMINGS.find((candidate): candidate is Timing => candidate === timing) ?? fail(what);
}

function parseVerdict(value: unknown, what: string): Verdict {
  const verdict = str(value, what);
  return VERDICT_VALUES.find((candidate) => candidate === verdict) ?? fail(`${what} is not a verdict: ${verdict}`);
}

function parseTagIds(value: unknown, what: string): number[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "number") fail(`${what}[${index}] is not a number`);
    return entry;
  });
}

const TAG_MODES: readonly string[] = ["any", "all", "exclude"];
const OVERRIDE_MODES: readonly string[] = ["inactive", "include", "exclude"];

function parseTagFilter(value: unknown, what: string): TagFilter {
  const raw = record(value, what);
  if (typeof raw.tagId !== "number") fail(`${what}.tagId is not a number`);
  const mode = str(raw.mode, `${what}.mode`);
  if (!TAG_MODES.includes(mode)) fail(`${what}.mode is not a tag mode: ${mode}`);
  const narrowed = TAG_MODES.find((candidate): candidate is TagFilterMode => candidate === mode) ?? fail(what);
  return { tagId: raw.tagId, mode: narrowed };
}

function parseOverride(value: unknown, what: string): ArchivedMode {
  const mode = str(value, what);
  if (!OVERRIDE_MODES.includes(mode)) fail(`${what} is not an override mode: ${mode}`);
  return OVERRIDE_MODES.find((candidate): candidate is ArchivedMode => candidate === mode) ?? fail(what);
}

function parseFilter(value: unknown, what: string): CorpusFilter {
  const raw = record(value, what);
  const preset = str(raw.preset, `${what}.preset`);
  if (!isListPreset(preset)) fail(`${what}.preset is not a preset: ${preset}`);
  const tags = raw.tags === undefined
    ? []
    : (Array.isArray(raw.tags) ? raw.tags : fail(`${what}.tags is not an array`))
      .map((tag, index) => parseTagFilter(tag, `${what}.tags[${index}]`));
  return {
    preset,
    tags,
    ...flag(raw.unblock, "unblock", what),
    ...flag(raw.expectations, "expectations", what),
    ...flag(raw.includeFlows, "includeFlows", what),
    ...flag(raw.showInfo, "showInfo", what),
    ...flag(raw.showFlow, "showFlow", what),
    ...flag(raw.privateMode, "privateMode", what),
    ...(raw.archived !== undefined ? { archived: parseOverride(raw.archived, `${what}.archived`) } : {}),
    ...(raw.backlog !== undefined ? { backlog: parseOverride(raw.backlog, `${what}.backlog`) } : {}),
  };
}

function parseCorpus(): Corpus {
  // Read as `unknown` rather than off the import's inferred shape: the corpus is the contract,
  // and a case that has drifted from it should fail here by name rather than somewhere downstream.
  const raw: unknown = corpusJson;
  const top = record(raw, "the corpus");
  if (!Array.isArray(top.cases)) fail("`cases` is not an array");
  const boards = record(top.boards, "`boards`");
  return {
    cases: top.cases.map((entry, index): CorpusCase => {
      const value = record(entry, `cases[${index}]`);
      const name = str(value.name, `cases[${index}].name`);
      return {
        name,
        spec: str(value.spec, `cases[${name}].spec`),
        filter: parseFilter(value.filter, `cases[${name}].filter`),
        board: str(value.board, `cases[${name}].board`),
        mindmap: ids(value.mindmap, `cases[${name}].mindmap`),
        list: ids(value.list, `cases[${name}].list`),
        commitments: ids(value.commitments, `cases[${name}].commitments`),
        expectations: value.expectations === undefined ? [] : ids(value.expectations, `cases[${name}].expectations`),
      };
    }),
    boards: Object.fromEntries(
      Object.entries(boards).map(([name, board]) => [name, parseNode(board, `boards.${name}`)]),
    ),
  };
}

/** The virtual-Habit-instance marker: its presence is what `isUnopenedOccurrence` keys on. */

/** A Habit flow's payload, reduced to the one field a filter reads off it. */
const HABIT_FLOW = {
  instanceType: "task", targetType: null, targetId: null, durationN: null, durationKind: null,
  windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: true,
  rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null,
  verdictWindowN: null, verdictWindowKind: null,
} as const;

function toMindmapNode(node: CorpusNode): MindmapNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.id,
    position: 0,
    tagIds: node.tagIds ?? [],
    children: (node.children ?? []).map(toMindmapNode),
    ...(node.status !== undefined ? { status: node.status } : {}),
    ...(node.timing !== undefined ? { timing: node.timing } : {}),
    ...(node.planTiming !== undefined ? { planTiming: node.planTiming } : {}),
    ...(node.verdict !== undefined ? { verdict: node.verdict } : {}),
    ...(node.archived === true ? { archived: true } : {}),
    ...(node.backlogged === true ? { backlogged: true } : {}),
    ...(node.isPrivate === true ? { isPrivate: true } : {}),
    ...(node.isBlocked === true ? { blockReasons: ["blocked"] } : {}),
    ...(node.isHabitFlow === true ? { flow: HABIT_FLOW } : {}),
    ...(node.isHabitOccurrence === true ? occurrenceRow() : {}),
    ...(node.delegated === true ? { delegate: { kind: "agent" as const } } : {}),
    ...(node.hasCheck === true ? { checkEvery: { n: 1, kind: "day" } } : {}),
  };
}

/** The shared filter a corpus filter names, with every unstated axis at its persisted default. */
function toSharedFilter(filter: CorpusFilter): FilterState {
  return {
    ...DEFAULT_FILTER,
    // Unblock is the List View's own option and never writes through to the shared preset — which
    // is exactly why the corpus carries the two separately.
    statusMode: asStatusMode(filter.preset),
    tagFilters: filter.tags ?? [],
    ...(filter.includeFlows !== undefined ? { modeIncludeFlows: filter.includeFlows } : {}),
    ...(filter.showInfo !== undefined ? { showInfo: filter.showInfo } : {}),
    ...(filter.showFlow !== undefined ? { showFlow: filter.showFlow } : {}),
    ...(filter.privateMode !== undefined ? { privateMode: filter.privateMode } : {}),
    ...(filter.archived !== undefined ? { archivedMode: filter.archived } : {}),
    ...(filter.backlog !== undefined ? { backlogMode: filter.backlog } : {}),
  };
}

/** The shared preset a corpus preset names. The List-View-only options never write through to it. */
function asStatusMode(preset: ListPreset): StatusMode {
  return STATUS_MODES.find((mode) => mode === preset) ?? DEFAULT_FILTER.statusMode;
}

const STATUS_MODES: readonly StatusMode[] = ["all", "plan", "start", "do", "backlog"];

function toListFilter(filter: CorpusFilter): ListFilterState {
  const preset: ListPreset = filter.unblock === true ? "unblock"
    : filter.expectations === true ? "expectations"
      : filter.preset;
  return { ...DEFAULT_LIST_FILTER, preset };
}

function keptIds(node: MindmapNode): string[] {
  const collected = [node.id];
  for (const child of node.children) collected.push(...keptIds(child));
  return collected;
}

const corpus = parseCorpus();

describe("preset conformance corpus", () => {
  it("names a board that exists for every case", () => {
    for (const testCase of corpus.cases) {
      expect(corpus.boards[testCase.board], testCase.name).toBeDefined();
    }
  });

  for (const testCase of corpus.cases) {
    describe(testCase.name, () => {
      const board = corpus.boards[testCase.board];
      const root = toMindmapNode(board ?? fail(`no board named ${testCase.board}`));
      const shared = toSharedFilter(testCase.filter);
      const listFilter = toListFilter(testCase.filter);

      it("keeps the stated nodes on the Mindmap", () => {
        const kept = keptIds(filterTree(root, shared)).filter((id) => id !== root.id);
        expect(kept.sort()).toEqual([...testCase.mindmap].sort());
      });

      it("keeps the stated task rows in the List View", () => {
        const rows = filterTaskList(flattenTaskRows(root, []), shared, listFilter);
        expect(rows.map((row) => row.node.id).sort()).toEqual([...testCase.list].sort());
      });

      it("keeps the stated commitment rows in the List View", () => {
        const rows = filterCommitmentList(flattenCommitmentRows(root), shared, listFilter);
        expect(rows.map((row) => row.node.id).sort()).toEqual([...testCase.commitments].sort());
      });

      it("keeps the stated expectation rows in the List View", () => {
        const rows = filterExpectationList(flattenExpectationRows(root), shared, listFilter);
        expect(rows.map((row) => row.node.id).sort()).toEqual([...testCase.expectations].sort());
      });
    });
  }
});

