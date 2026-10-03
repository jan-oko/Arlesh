import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/plan-triage.json";
import { fail, record, str } from "@/test/conformance-board";
import type { ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";
import { keyForRef, keyStartDate, scopeKeyFrom, scopeKeyText } from "@/utils/scope-key";
import { keyWindow } from "@/utils/scope-window";
import type { ScopeWindows } from "@/utils/plan-triage";
import { partitionForScope, planRefusal, referencedScopeIds } from "@/utils/plan-triage";
import { takeOutTarget } from "@/utils/plan-take-out";
import { parentRefs } from "@/utils/plan-scope";

/**
 * The Plan View's rules have two evaluators: `plan-triage.ts`, `plan-take-out.ts` and `parentRefs`,
 * which the Plan View re-runs per step through the calendar, and `tasks::rules::plan`, whose bounds
 * are the writer's own. `conformance/plan-triage.json` holds them together;
 * `src-tauri/tests/operations/plan_triage_conformance.rs` is this file's other half.
 */

function array(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

function key(value: unknown, what: string): ScopeKey {
  return scopeKeyFrom(value) ?? fail(`${what} is not a scope key`);
}

function scope(value: unknown, what: string): TimeScope | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, what);
  return { start_id: key(raw.start_id, `${what}.start_id`), end_id: key(raw.end_id, `${what}.end_id`) };
}

function ids(value: unknown, what: string): string[] {
  return array(value, what).map((entry, index) => str(entry, `${what}[${index}]`));
}

/** One corpus node, drawn as the board draws it. */
function node(raw: Record<string, unknown>, id: string, kind: NodeKind, what: string): MindmapNode {
  const timeScope = scope(raw.timeScope, `${what}.timeScope`);
  const plan = scope(raw.plan, `${what}.plan`);
  return {
    id, kind, title: id, position: 0, tagIds: [], children: [],
    ...(timeScope !== undefined ? { timeScope } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(raw.overdue === true ? { overdue: true } : {}),
    ...(raw.virtual === true ? { virtual: true } : {}),
  };
}

/** One corpus row, as the List View flattens it. */
function row(value: unknown, what: string): TaskListRow {
  const raw = record(value, what);
  const ancestors = (raw.ancestors === undefined ? [] : array(raw.ancestors, `${what}.ancestors`)).map((entry, index) => {
    const ancestor = record(entry, `${what}.ancestors[${index}]`);
    const kind = str(ancestor.kind, `${what}.ancestors[${index}].kind`);
    if (!isNodeKind(kind)) fail(`${what}.ancestors[${index}].kind is not a node kind`);
    return node(ancestor, `${kind}-${index}`, kind, `${what}.ancestors[${index}]`);
  });
  return {
    node: node(raw, str(raw.id, `${what}.id`), "task", what),
    ancestors,
    goalRef: null, goalStatus: null, projectRef: null, projectStatus: null, dependencyRefs: [],
    isBlocked: false, heldByBlockedAncestor: false, isAgentic: false, isAsynchronous: false,
    hasPrivateAncestor: false, scopeTokens: [],
  };
}

/** Every scope the rows and the target name, resolved to its window as the backend would. */
function windowsFor(rows: readonly TaskListRow[], extra: readonly ScopeKey[]): ScopeWindows {
  return new Map([...referencedScopeIds(rows), ...extra].map((k) => [scopeKeyText(k), keyWindow(k)]));
}

const top = record(corpusJson, "the corpus");

describe("plan triage conformance corpus", () => {
  for (const [index, value] of array(top.triage, "`triage`").entries()) {
    const entry = record(value, `triage[${index}]`);
    const name = str(entry.name, `triage[${index}].name`);
    it(name, () => {
      const rows = array(entry.rows, `${name}.rows`).map((r, i) => row(r, `${name}.rows[${i}]`));
      const target = key(entry.target, `${name}.target`);
      const parent = entry.parent === null ? null : key(entry.parent, `${name}.parent`);
      const panes = partitionForScope(
        rows, keyWindow(target), windowsFor(rows, [target]),
        new Set(parent === null ? [] : [scopeKeyText(parent)]),
      );
      expect(panes.unplanned.map((r) => r.node.id)).toEqual(ids(entry.unplanned, `${name}.unplanned`));
      expect(panes.planned.map((r) => r.node.id)).toEqual(ids(entry.planned, `${name}.planned`));
      expect(panes.parentPlanned.map((r) => r.node.id)).toEqual(ids(entry.parentPlanned, `${name}.parentPlanned`));
    });
  }

  for (const [index, value] of array(top.refusals, "`refusals`").entries()) {
    const entry = record(value, `refusals[${index}]`);
    const name = str(entry.name, `refusals[${index}].name`);
    it(name, () => {
      const subject = row(entry.row, `${name}.row`);
      const target = key(entry.target, `${name}.target`);
      expect(planRefusal(subject, keyWindow(target), windowsFor([subject], [target]))).toBe(entry.refusal);
    });
  }

  for (const [index, value] of array(top.parents, "`parents`").entries()) {
    const entry = record(value, `parents[${index}]`);
    const child = key(entry.scope, `parents[${index}].scope`);
    it(`the scope above ${scopeKeyText(child)}`, () => {
      const refs = parentRefs({ kind: child.kind, start_date: keyStartDate(child), end_date: keyStartDate(child) });
      const parents = refs.map((ref) => scopeKeyText(keyForRef(ref)));
      expect(parents).toEqual(entry.parent === null ? [] : [scopeKeyText(key(entry.parent, `parents[${index}].parent`))]);
    });
  }

  for (const [index, value] of array(top.takeOut, "`takeOut`").entries()) {
    const entry = record(value, `takeOut[${index}]`);
    it(`work taken out with split=${String(entry.split)} and parent=${String(entry.hasParent)}`, () => {
      const landed = takeOutTarget(entry.split === true, "filled", entry.hasParent === true ? "parent" : null);
      expect(landed.kind === "clear" ? "clear" : landed.scope).toBe(entry.lands);
    });
  }
});
