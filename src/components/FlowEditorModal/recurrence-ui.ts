import type { ConsumptionKind, BlockingMode, CatchupPolicy } from "@/api/flows";

/** UI state for a flow's Recurrence (a Habit). Dates are materialized to scope ids on save. */
export interface RecurrenceUi {
  isHabit: boolean;
  /** First occurrence day (ISO `YYYY-MM-DD`). */
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
