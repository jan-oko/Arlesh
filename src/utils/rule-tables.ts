import type { RuleTables, TakeOutLanding } from "@/api/rules";
import type { NodeKind } from "@/utils/tree-layout";

/**
 * The rules that never change while the app runs, as Rust answers them (`rule_tables`): which kinds
 * may hold which, and where taken-out work lands. They are loaded once, before the first render
 * (`main.tsx`, through `loadRuleTables`), so a pointer move over a drop target asks a table, never the network.
 */
let tables: RuleTables | null = null;

/** Installs the tables Rust served (`loadRuleTables` in `src/api/rules.ts`), or `null` for none. */
export function setRuleTables(loaded: RuleTables | null): void {
  tables = loaded;
}

function loaded(): RuleTables {
  if (tables === null) throw new Error("the rule tables were read before they were loaded");
  return tables;
}

/** Whether a node of kind `child` may hang directly under one of kind `parent`
 * (`nodes::rules::parenting::may_parent`). */
export function mayParent(child: NodeKind, parent: NodeKind): boolean {
  const column = loaded().parenting.find((entry) => entry.child === child);
  return column !== undefined && column.parents.includes(parent);
}

/** Where work taken out of a scope lands (`tasks::rules::plan::take_out`). */
export function takeOutLanding(split: boolean, hasParent: boolean): TakeOutLanding {
  const found = loaded().takeOut.find((entry) => entry.split === split && entry.hasParent === hasParent);
  if (found === undefined) throw new Error("the take-out table has no row for this case");
  return found.lands;
}
