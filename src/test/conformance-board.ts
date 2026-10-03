import { occurrenceRow } from "@/test/occurrence";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";
import type { ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { scopeKeyFrom } from "@/utils/scope-key";
import type { Timing } from "@/api/scope-lifecycle";
import type { Verdict } from "@/api/verdict";
import type { AgenticStatus, OrdinaryStatus, TaskDependencyEdge, TaskStatus } from "@/api/tasks";
import { VERDICT_VALUES } from "@/api/verdict";

/**
 * A conformance corpus's boards, read for the frontend's evaluators.
 *
 * Every corpus under `conformance/` writes its boards the same way: a tree of nodes, each carrying
 * only the facts a rule reads (`NodeFacts` on the Rust side). This parses one strictly — a node that
 * has drifted from the shape fails here by name — and draws it as the `MindmapNode` the app would.
 */

/** One node of a corpus board: the facts a filter reads, and nothing else. */
export interface CorpusNode {
  id: string;
  kind: NodeKind;
  status?: string;
  timing?: Timing;
  planTiming?: Timing;
  archived?: boolean;
  overdue?: boolean;
  backlogged?: boolean;
  verdict?: Verdict;
  isPrivate?: boolean;
  isBlocked?: boolean;
  blockingDependencies?: string[];
  isHabitFlow?: boolean;
  isHabitOccurrence?: boolean;
  delegated?: boolean;
  /** A Task's status is of the Agentic model. */
  agentic?: boolean;
  hasCheck?: boolean;
  tagIds?: number[];
  timeScope?: TimeScope;
  /** A Task is Asynchronous. */
  asynchronous?: boolean;
  /** It has a Plan of its own. */
  planned?: boolean;
  /** Its lapse was settled as Missed. */
  missed?: boolean;
  /** Every node it depends on, met or not. */
  dependencies?: string[];
  /** A Task is Compound: it consists of its sub-items. */
  compound?: boolean;
  /** An Expectation is an agentic wait: an agent raised it. */
  agentWaiting?: boolean;
  children?: CorpusNode[];
}

export function fail(what: string): never {
  throw new Error(`conformance corpus: ${what}`);
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return { ...value };
}

export function str(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} is not a string`);
  return value;
}

function optionalBool(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${what} is not a boolean`);
  return value;
}

export function ids(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value.map((entry, index) => str(entry, `${what}[${index}]`));
}

export function parseNode(value: unknown, what: string): CorpusNode {
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
    ...flag(raw.overdue, "overdue", what),
    ...flag(raw.backlogged, "backlogged", what),
    ...flag(raw.isPrivate, "isPrivate", what),
    ...flag(raw.isBlocked, "isBlocked", what),
    ...flag(raw.isHabitFlow, "isHabitFlow", what),
    ...flag(raw.isHabitOccurrence, "isHabitOccurrence", what),
    ...flag(raw.delegated, "delegated", what),
    ...flag(raw.agentic, "agentic", what),
    ...flag(raw.hasCheck, "hasCheck", what),
    ...flag(raw.asynchronous, "asynchronous", what),
    ...flag(raw.planned, "planned", what),
    ...flag(raw.missed, "missed", what),
    ...flag(raw.compound, "compound", what),
    ...flag(raw.agentWaiting, "agentWaiting", what),
    ...(raw.dependencies !== undefined ? { dependencies: ids(raw.dependencies, `${what}.dependencies`) } : {}),
    ...(raw.timeScope !== undefined ? { timeScope: parseTimeScope(raw.timeScope, `${what}.timeScope`) } : {}),
    ...(raw.blockingDependencies !== undefined
      ? { blockingDependencies: ids(raw.blockingDependencies, `${what}.blockingDependencies`) }
      : {}),
  };
}

export function parseScopeKey(value: unknown, what: string): ScopeKey {
  return scopeKeyFrom(value) ?? fail(`${what} is not a scope key`);
}

function parseTimeScope(value: unknown, what: string): TimeScope {
  const raw = record(value, what);
  return { start_id: parseScopeKey(raw.start_id, `${what}.start_id`), end_id: parseScopeKey(raw.end_id, `${what}.end_id`) };
}

export function flag(value: unknown, name: string, what: string): Record<string, boolean> {
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

/** The virtual-Habit-instance marker: its presence is what `isUnopenedOccurrence` keys on. */

/** A Habit flow's payload, reduced to the one field a filter reads off it. */
const HABIT_FLOW = {
  instanceType: "task", targetType: null, targetId: null, durationN: null, durationKind: null,
  windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: true,
  rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null,
  verdictWindowN: null, verdictWindowKind: null,
} as const;

const ORDINARY: readonly OrdinaryStatus[] = ["todo", "in_progress", "started", "done"];
const AGENTIC: readonly AgenticStatus[] = ["todo", "on_agent", "review", "doing", "done"];

/** A corpus Task's status in the model its `agentic` fact names; a spelling outside it fails. */
function corpusTaskStatus(node: CorpusNode): TaskStatus {
  const what = `${node.id}.status`;
  if (node.agentic === true) {
    const status = AGENTIC.find((candidate) => candidate === node.status) ?? fail(`${what} is not an Agentic status`);
    return { kind: "agentic", status };
  }
  const status = ORDINARY.find((candidate) => candidate === node.status) ?? fail(`${what} is not a Task status`);
  return { kind: "ordinary", status };
}

/** A Plan, for a node the corpus says has one. Only its presence is read. */
const SOME_PLAN: TimeScope = {
  start_id: parseScopeKey({ kind: "day", date: "2026-01-05" }, "SOME_PLAN"),
  end_id: parseScopeKey({ kind: "day", date: "2026-01-05" }, "SOME_PLAN"),
};

/** The kind and row id a corpus node id spells: `task-async` is the Task with row id `async`. */
function rowRef(id: string): { type: string; rowId: string } {
  const dash = id.indexOf("-");
  if (dash < 0) fail(`${id} has no kind prefix`);
  return { type: id.slice(0, dash), rowId: id.slice(dash + 1) };
}

/** The dependency edges a board's `dependencies` facts name, as the app loads them. */
export function dependencyEdges(node: CorpusNode): TaskDependencyEdge[] {
  const own = (node.dependencies ?? []).map((target): TaskDependencyEdge => {
    const ref = rowRef(target);
    return { task_id: rowRef(node.id).rowId, dependency_type: ref.type, dependency_id: ref.rowId };
  });
  return [...own, ...(node.children ?? []).flatMap(dependencyEdges)];
}

export function toMindmapNode(node: CorpusNode): MindmapNode {
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
    ...(node.overdue === true ? { overdue: true } : {}),
    ...(node.backlogged === true ? { backlogged: true } : {}),
    ...(node.isPrivate === true ? { isPrivate: true } : {}),
    ...(node.isBlocked === true ? { blockReasons: ["blocked"] } : {}),
    ...(node.blockingDependencies !== undefined ? { blockingDependencyIds: node.blockingDependencies } : {}),
    ...(node.isHabitFlow === true ? { flow: HABIT_FLOW } : {}),
    ...(node.isHabitOccurrence === true ? occurrenceRow() : {}),
    ...(node.delegated === true ? { delegate: { kind: "person" as const, id: 1 } } : {}),
    ...(node.kind === "task" && node.status !== undefined ? { taskStatus: corpusTaskStatus(node) } : {}),
    ...(node.hasCheck === true ? { checkEvery: { n: 1, kind: "day" } } : {}),
    ...(node.timeScope !== undefined ? { timeScope: node.timeScope } : {}),
    // A Task whose status is of the Agentic model reads as Agentic: the model follows the flag.
    ...(node.kind === "task" && node.agentic === true ? { agentic: true } : {}),
    ...(node.kind === "task" ? { rowId: rowRef(node.id).rowId } : {}),
    ...(node.asynchronous === true ? { asynchronous: true } : {}),
    ...(node.planned === true ? { plan: SOME_PLAN } : {}),
    ...(node.missed === true ? { resolution: "missed" as const } : {}),
    ...(node.compound === true ? { compound: true } : {}),
    ...(node.agentWaiting === true ? { agentWaiting: { note: null, question: true, answer: null } } : {}),
  };
}
