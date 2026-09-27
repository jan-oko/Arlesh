import { useEffect, useMemo, useState } from "react";

import { getScope, resolveScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { ScopeConstraint } from "@/components/ScopePicker/ScopePicker";
import { useScopePicker, type UseScopePicker } from "@/hooks/use-scope-picker";
import { dayScopeDate, lastDayOfWindow, openingForRefs, type ScopeOpening } from "@/utils/scope-calendar";
import { refsForScopes } from "@/utils/scope-ref";
import { scopeKeyText } from "@/utils/scope-key";

/**
 * The inclusive Day range a resolved window constrains the picker to. Both ends read as Day
 * scopes rather than calendar dates: a Day runs 02:00 -> 02:00, so a window starting at 00:30
 * starts in the previous Day, and one ending at 02:00 ends with the Day before it.
 */
function constraintDates(startIso: string, endIso: string): ScopeConstraint {
  const [date, time] = startIso.split("T");
  const startDate =
    date === undefined || time === undefined ? startIso : dayScopeDate(date, Number(time.slice(0, 2)));
  return { startDate, endDate: lastDayOfWindow(endIso) };
}

function timeScopeText(scope: TimeScope): string {
  return `${scopeKeyText(scope.start_id)}/${scopeKeyText(scope.end_id)}`;
}

/** A Plan picker's state, ready to hand to a `ScopePicker`. */
export interface PlanPicker {
  /** The range selection the picker writes into. */
  picker: UseScopePicker;
  /** The Time Scope's Days, once resolved; absent while resolving and when there is no bound. */
  constraint: ScopeConstraint | undefined;
  /** The view and date the picker opens on: the Plan already chosen, or `null` for the default. */
  opening: ScopeOpening | null;
  /** The stored Plan's two endpoint scopes, once fetched — what its label is written from. */
  endpoints: [Scope, Scope] | null;
}

/**
 * Everything a **Plan** picker needs besides its own chrome, shared by the editor's Plan field and
 * the `P` quick picker so the two cannot disagree: the picker constrained to the Task's Time Scope
 * (a Plan must fall within it; pass `null` for no bound — an Overdue Task, or none set), opened on
 * the Plan already chosen and with it selected, so the period on screen is the one Apply re-applies.
 *
 * `open` gates the work that only an open picker needs: the constraint is resolved, and the
 * selection re-seeded, each time it opens.
 */
export function usePlanPicker(value: TimeScope | null, timeScope: TimeScope | null, open: boolean): PlanPicker {
  // Each fetch is tagged with what it was made for, so a previous value's answer is never shown.
  const [resolved, setResolved] = useState<{ key: string; constraint: ScopeConstraint } | null>(null);
  const [fetched, setFetched] = useState<{ key: string; scopes: [Scope, Scope] } | null>(null);
  const picker = useScopePicker("range");

  useEffect(() => {
    if (!open || timeScope === null) return;
    let active = true;
    const key = timeScopeText(timeScope);
    void Promise.all([resolveScope(timeScope.start_id), resolveScope(timeScope.end_id)]).then(([start, end]) => {
      if (active && start != null && end != null) setResolved({ key, constraint: constraintDates(start.start, end.end) });
    });
    return () => {
      active = false;
    };
  }, [open, timeScope]);

  useEffect(() => {
    if (value === null) return;
    let active = true;
    const key = timeScopeText(value);
    void Promise.all([getScope(value.start_id), getScope(value.end_id)]).then(([start, end]) => {
      if (active && start != null && end != null) setFetched({ key, scopes: [start, end] });
    });
    return () => {
      active = false;
    };
  }, [value]);

  const valueKey = value === null ? null : timeScopeText(value);
  const endpoints = fetched !== null && fetched.key === valueKey ? fetched.scopes : null;
  const boundKey = timeScope === null ? null : timeScopeText(timeScope);
  const constraint = open && resolved !== null && resolved.key === boundKey ? resolved.constraint : undefined;
  const valueRefs = useMemo(() => (endpoints === null ? [] : refsForScopes(endpoints)), [endpoints]);
  // Open on the plan already chosen; with none (or one that names no cell), the default view.
  const opening = openingForRefs(valueRefs);

  const seed = picker.seed;
  useEffect(() => {
    if (!open) return;
    seed(valueRefs);
  }, [open, valueRefs, seed]);

  return { picker, constraint, opening, endpoints };
}
