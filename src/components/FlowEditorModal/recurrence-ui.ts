import type { ConsumptionKind, BlockingMode, CatchupPolicy, SetRecurrenceRequest } from "@/api/flows";
import type { CanonicalKind } from "@/utils/scope-ref";
import { keyContaining } from "@/utils/scope-key";
import type { RecurrenceSave } from "./FlowEditorModal";

/** UI state for a flow's Recurrence (a Habit). Dates become scope keys on save. */
export interface RecurrenceUi {
  isHabit: boolean;
  /** Start scope's anchor day (ISO `YYYY-MM-DD`), of the kind `recurrenceStartKind` derives. */
  startDate: string;
  gapEnabled: boolean;
  gapN: number;
  gapKind: string;
  endEnabled: boolean;
  endDate: string;
  consumptionKind: ConsumptionKind;
  /** Used iff Accumulating. */
  blockingMode: BlockingMode;
  /** Used iff Blocking. */
  catchupPolicy: CatchupPolicy;
}

/**
 * The canonical scope kind a Recurrence's start/end anchors to: the flow's Duration kind, or Day
 * for a sub-day (Phase) or unscoped flow.
 */
export function recurrenceStartKind(flowDurationKind: string | null): CanonicalKind {
  return flowDurationKind === "week" || flowDurationKind === "month" || flowDurationKind === "season"
    ? flowDurationKind
    : "day";
}

/**
 * The backend request that makes a flow a Habit with `recurrence`: its dates turned into keys of
 * the scope kind the Recurrence anchors to. One mapping for the editor's two saves — an existing
 * flow switched to repeating, and a new Habit created in one step (Shift+H).
 */
export function recurrenceRequest(recurrence: RecurrenceSave, flowDurationKind: string | null): SetRecurrenceRequest {
  const startKind = recurrenceStartKind(flowDurationKind);
  return {
    start_scope_id: keyContaining(startKind, recurrence.startDate),
    gap_n: recurrence.gapN,
    gap_kind: recurrence.gapKind,
    end_scope_id: recurrence.endDate !== null ? keyContaining(startKind, recurrence.endDate) : null,
    consumption_kind: recurrence.consumptionKind,
    blocking_mode: recurrence.blockingMode,
    catchup_policy: recurrence.catchupPolicy,
  };
}

/** A blank Recurrence: continuous, open-ended, Destructive. */
export function defaultRecurrence(startDate: string): RecurrenceUi {
  return {
    isHabit: false,
    startDate,
    gapEnabled: false,
    gapN: 1,
    gapKind: "day",
    endEnabled: false,
    endDate: startDate,
    consumptionKind: "destructive",
    blockingMode: "overlapping",
    catchupPolicy: "next",
  };
}
