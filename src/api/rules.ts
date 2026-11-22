import { invokeOutsideGesture as invoke } from "./gesture";
import { setRuleTables } from "@/utils/rule-tables";
import type { ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { NodeKind } from "@/utils/tree-layout";

/**
 * The rules the app draws by, asked of Rust as data. The rules live in `arlesh-rules`; the frontend
 * holds none of them. These commands are pure, so they answer the same in either mode.
 */

/** One ancestor of a row: the Time Scope a row with none of its own inherits. */
export interface PlanAncestorInput {
  timeScope: TimeScope | null;
}

/** One row a planning pass reads, in the shape `tasks::rules::plan` reads it. */
export interface PlanRowInput {
  id: string;
  /** Drawn but not stored: it has nowhere to write a Plan. */
  virtual: boolean;
  timeScope: TimeScope | null;
  plan: TimeScope | null;
  inheritedPlan: TimeScope | null;
  /** Something above it is planned but that Plan comes to nothing inside its window. */
  emptyPlan: boolean;
  overdue: boolean;
  /** Its ancestors, root first. */
  ancestors: PlanAncestorInput[];
}

/** Which containment bound a Plan move would break (`tasks::rules::plan::PlanRefusal`). */
export type PlanRefusalWire = "own_time_scope" | "parent_plan";

/** What one planning pass makes of the rows: three heaps by row id, and the refusals into the
 * scope being filled. */
export interface PlanTriageAnswer {
  unplanned: string[];
  planned: string[];
  parentPlanned: string[];
  /** Row id to the bound planning it into the scope would break; a row absent from it may move. */
  refusals: Record<string, PlanRefusalWire>;
}

/** Where work taken out of the planned pane lands. */
export type TakeOutLanding = "filled" | "parent" | "clear";

/** The rules that never change while the app runs. */
export interface RuleTables {
  /** For every kind, the kinds it may hang directly under. */
  parenting: Array<{ child: NodeKind; parents: NodeKind[] }>;
  /** Where taken-out work lands, for every case. */
  takeOut: Array<{ split: boolean; hasParent: boolean; lands: TakeOutLanding }>;
}

/** The tables of rules, read once before the first render. */
export async function fetchRuleTables(): Promise<RuleTables> {
  return invoke<RuleTables>("rule_tables");
}

/** Reads the tables once, at start, and holds them for `src/utils/rule-tables.ts` to answer from. */
export async function loadRuleTables(): Promise<void> {
  setRuleTables(await fetchRuleTables());
}

/** The Plan View's triage of `rows` for the scope `target`, whose parent is `parent` (`null` for a
 * Season). */
export async function fetchPlanTriage(
  target: ScopeKey, parent: ScopeKey | null, rows: readonly PlanRowInput[],
): Promise<PlanTriageAnswer> {
  return invoke<PlanTriageAnswer>("plan_triage", { target, parent, rows });
}

/** The bound each of `rows` would break were it planned into `target`, by row id. */
export async function fetchPlanRefusals(
  target: ScopeKey, rows: readonly PlanRowInput[],
): Promise<Record<string, PlanRefusalWire>> {
  return invoke<Record<string, PlanRefusalWire>>("plan_refusals", { target, rows });
}
