import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/preset-filters.json";
import type { MindmapNode } from "@/utils/tree-layout";
import type { CorpusNode } from "@/test/conformance-board";
import {
  dependencyEdges, fail, flag, ids, parseNode, parseScopeKey, record, str, toMindmapNode,
} from "@/test/conformance-board";
import type { FilterState, ArchivedMode, ScopeMatch, StatusMode, TagFilter, TagFilterMode } from "@/utils/filter-tree";
import type { ScopeKey } from "@/api/scopes";
import { DEFAULT_FILTER, filterTree } from "@/utils/filter-tree";
import type { ListFilterState, ListPreset, ListRowKind, PillDimension, PillFilter } from "@/utils/list-filter";
import {
  DEFAULT_LIST_FILTER, LIST_ROW_KINDS, PILL_DIMENSIONS, filterCommitmentList, filterExpectationList, filterTaskList,
  isListPreset, isListRowKind,
} from "@/utils/list-filter";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";

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
  planScope?: ScopeKey;
  scopeMatch?: ScopeMatch;
  startHidesCheckedWaits?: boolean;
  startShowsStarted?: boolean;
  doShowsStarted?: boolean;
  showOnAgent?: boolean;
  /** The List View's kind selector; every kind when omitted. */
  kinds?: ListRowKind[];
  /** The List View's pills, by dimension; a dimension left out holds none. */
  pills?: Partial<Record<PillDimension, PillFilter[]>>;
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

const SCOPE_MATCHES: readonly ScopeMatch[] = ["contained", "overlapping"];

function parseScopeMatch(value: unknown, what: string): ScopeMatch {
  const match = str(value, what);
  return SCOPE_MATCHES.find((candidate) => candidate === match) ?? fail(`${what} is not a scope match: ${match}`);
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

function parseKinds(value: unknown, what: string): ListRowKind[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value.map((kind, index) => (isListRowKind(kind) ? kind : fail(`${what}[${index}] is not a row kind`)));
}

function parsePill(value: unknown, what: string): PillFilter {
  const raw = record(value, what);
  const mode = str(raw.mode, `${what}.mode`);
  const narrowed = TAG_MODES.find((candidate): candidate is TagFilterMode => candidate === mode)
    ?? fail(`${what}.mode is not a pill mode: ${mode}`);
  return { value: str(raw.value, `${what}.value`), mode: narrowed };
}

function parsePills(value: unknown, what: string): Partial<Record<PillDimension, PillFilter[]>> {
  const raw = record(value, what);
  for (const key of Object.keys(raw)) {
    if (!PILL_DIMENSIONS.some((dimension) => dimension === key)) fail(`${what}.${key} is not a pill dimension`);
  }
  const pills: Partial<Record<PillDimension, PillFilter[]>> = {};
  for (const dimension of PILL_DIMENSIONS) {
    const listed = raw[dimension];
    if (listed === undefined) continue;
    if (!Array.isArray(listed)) fail(`${what}.${dimension} is not an array`);
    pills[dimension] = listed.map((entry, index) => parsePill(entry, `${what}.${dimension}[${index}]`));
  }
  return pills;
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
    ...(raw.planScope !== undefined ? { planScope: parseScopeKey(raw.planScope, `${what}.planScope`) } : {}),
    ...(raw.scopeMatch !== undefined ? { scopeMatch: parseScopeMatch(raw.scopeMatch, `${what}.scopeMatch`) } : {}),
    ...flag(raw.startHidesCheckedWaits, "startHidesCheckedWaits", what),
    ...flag(raw.startShowsStarted, "startShowsStarted", what),
    ...flag(raw.doShowsStarted, "doShowsStarted", what),
    ...flag(raw.showOnAgent, "showOnAgent", what),
    ...(raw.kinds !== undefined ? { kinds: parseKinds(raw.kinds, `${what}.kinds`) } : {}),
    ...(raw.pills !== undefined ? { pills: parsePills(raw.pills, `${what}.pills`) } : {}),
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
    ...(filter.planScope !== undefined ? { planScope: filter.planScope } : {}),
    ...(filter.scopeMatch !== undefined ? { scopeMatch: filter.scopeMatch } : {}),
    ...(filter.startHidesCheckedWaits !== undefined ? { startHidesCheckedWaits: filter.startHidesCheckedWaits } : {}),
    ...(filter.startShowsStarted !== undefined ? { startShowsStarted: filter.startShowsStarted } : {}),
    ...(filter.doShowsStarted !== undefined ? { doShowsStarted: filter.doShowsStarted } : {}),
    ...(filter.showOnAgent !== undefined ? { showOnAgent: filter.showOnAgent } : {}),
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
  return {
    preset,
    kinds: filter.kinds ?? [...LIST_ROW_KINDS],
    pills: { ...DEFAULT_LIST_FILTER.pills, ...filter.pills },
  };
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
      const edges = dependencyEdges(board ?? fail(`no board named ${testCase.board}`));

      it("keeps the stated nodes on the Mindmap", () => {
        const kept = keptIds(filterTree(root, shared)).filter((id) => id !== root.id);
        expect(kept.sort()).toEqual([...testCase.mindmap].sort());
      });

      it("keeps the stated task rows in the List View", () => {
        const rows = filterTaskList(flattenTaskRows(root, edges), shared, listFilter);
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

