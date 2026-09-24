import type { ConsumptionKind, BlockingMode, CatchupPolicy } from "@/api/flows";
import type { CanonicalKind } from "@/utils/scope-ref";

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
