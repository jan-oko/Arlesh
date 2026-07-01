import { useCallback, useState } from "react";

import { getOrCreateExactScope, getOrCreatePartScope, getOrCreateScope } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import {
  adjustRangeEndpoint,
  nextRangeSelection,
  nextSingleSelection,
  type RangeSelection,
  type ScopeRef,
} from "@/utils/scope-ref";

/** Materializes a calendar cell to its scope id, creating the scope on demand. */
async function materializeRef(ref: ScopeRef): Promise<number> {
  if (ref.kind === "part_of_day") {
    return (await getOrCreatePartScope(ref.date, ref.part)).id;
  }
  if (ref.kind === "exact") {
    return (await getOrCreateExactScope(ref.start, ref.end)).id;
  }
  return (await getOrCreateScope(ref.kind, ref.date)).id;
}

/** Single = one scope (Plan or a single-scope Time Scope); range = a boundaries window. */
export type ScopePickerMode = "single" | "range";

/** Return shape of {@link useScopePicker}. */
export interface UseScopePicker {
  /** The active mode. */
  mode: ScopePickerMode;
  /** Current single-mode selection (null in range mode or when nothing is picked). */
  single: ScopeRef | null;
  /** Current range-mode selection (empty endpoints in single mode). */
  range: RangeSelection;
  /** Applies a cell click per the active mode's selection rules. */
  handleClick: (ref: ScopeRef) => void;
  /** Moves a range endpoint (drag adjust); no-op semantics in single mode. */
  adjustEndpoint: (which: "start" | "end", ref: ScopeRef) => void;
  /** Clears the selection. */
  reset: () => void;
  /** Materializes the current selection to a Time Scope, or null if incomplete. */
  resolve: () => Promise<TimeScope | null>;
}

/**
 * Headless Scope Picker selection state. Holds the current selection as calendar-cell references
 * (synchronous, testable) and materializes them to scope ids only on {@link UseScopePicker.resolve}.
 */
export function useScopePicker(mode: ScopePickerMode): UseScopePicker {
  const [single, setSingle] = useState<ScopeRef | null>(null);
  const [range, setRange] = useState<RangeSelection>({ start: null, end: null });

  const handleClick = useCallback(
    (ref: ScopeRef) => {
      if (mode === "single") {
        setSingle((current) => nextSingleSelection(current, ref));
      } else {
        setRange((current) => nextRangeSelection(current, ref));
      }
    },
    [mode],
  );

  const adjustEndpoint = useCallback((which: "start" | "end", ref: ScopeRef) => {
    setRange((current) => adjustRangeEndpoint(current, which, ref));
  }, []);

  const reset = useCallback(() => {
    setSingle(null);
    setRange({ start: null, end: null });
  }, []);

  const resolve = useCallback(async (): Promise<TimeScope | null> => {
    if (mode === "single") {
      if (single === null) return null;
      const id = await materializeRef(single);
      return { start_id: id, end_id: id };
    }
    if (range.start === null || range.end === null) return null;
    const [startId, endId] = await Promise.all([
      materializeRef(range.start),
      materializeRef(range.end),
    ]);
    return { start_id: startId, end_id: endId };
  }, [mode, single, range]);

  return { mode, single, range, handleClick, adjustEndpoint, reset, resolve };
}
