import { useEffect, useState } from "react";
import type { ScopeKey } from "@/api/scopes";
import { partitionForScope } from "@/utils/plan-triage";
import type { PlanPanes } from "@/utils/plan-triage";
import type { TaskListRow } from "@/utils/list-filter";

/** No pane holds anything: what the view shows until the first answer, and with no scope. */
export const NO_PANES: PlanPanes = { unplanned: [], planned: [], parentPlanned: [] };

/**
 * The heaps the Plan View shows for the scope being filled, as Rust triages them
 * (`tasks::rules::plan::triage`, through the `plan_triage` command).
 *
 * The answer follows its inputs: it is asked again when the rows, the scope or its parent change,
 * and an answer to an input that has since changed is dropped. Until the first answer arrives, and
 * while the next one is on its way, the panes keep what they last showed rather than empty out and
 * flicker. With no `target` they are empty.
 */
export function usePlanPanes(rows: readonly TaskListRow[], target: ScopeKey | null, parent: ScopeKey | null): PlanPanes {
  const [panes, setPanes] = useState<PlanPanes>(NO_PANES);

  useEffect(() => {
    if (target === null) return;
    let current = true;
    void partitionForScope(rows, target, parent).then(
      (answer) => { if (current) setPanes(answer); },
      () => { if (current) setPanes(NO_PANES); },
    );
    return () => { current = false; };
  }, [rows, target, parent]);

  return target === null ? NO_PANES : panes;
}
