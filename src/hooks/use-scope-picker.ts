import { useCallback, useState } from "react";

import type { TimeScope } from "@/api/time-scope";
import { keyForRef } from "@/utils/scope-key";
import {
  adjustRangeEndpoint,
  nextRangeSelection,
  nextSingleSelection,
  seededRange,
  type RangeSelection,
  type ScopeRef,
} from "@/utils/scope-ref";

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
  /**
   * Replaces the selection with the cells a stored value occupies, so that opening the picker on
   * an existing scope pre-selects it and Apply re-applies it. An empty list seeds nothing.
   */
  seed: (refs: ScopeRef[]) => void;
  /** The current selection as a Time Scope of value keys, or null if incomplete. */
  resolve: () => Promise<TimeScope | null>;
}

/**
 * Headless Scope Picker selection state. Holds the current selection as calendar-cell references
 * (synchronous, testable) and turns them into scope keys on {@link UseScopePicker.resolve}. A key is
 * the cell's own value (ADR 0009), so nothing is written: an Exact window is registered by the save
 * that stores it.
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

  const seed = useCallback(
    (refs: ScopeRef[]) => {
      if (mode === "single") {
        setSingle(refs[0] ?? null);
        return;
      }
      setRange(seededRange(refs));
    },
    [mode],
  );

  const resolve = useCallback(async (): Promise<TimeScope | null> => {
    if (mode === "single") {
      if (single === null) return null;
      const id = keyForRef(single);
      return Promise.resolve({ start_id: id, end_id: id });
    }
    // One endpoint = a single scope (start === end); two = a range.
    if (range.start === null) return null;
    return Promise.resolve({
      start_id: keyForRef(range.start),
      end_id: keyForRef(range.end ?? range.start),
    });
  }, [mode, single, range]);

  return { mode, single, range, handleClick, adjustEndpoint, reset, seed, resolve };
}
