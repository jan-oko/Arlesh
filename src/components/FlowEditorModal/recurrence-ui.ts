import type { ClockKind, MissPolicy, SetRecurrenceRequest } from "@/api/flows";
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
  clock: ClockKind;
  /** Used iff the clock is Window; kept while Interval is picked, so switching back restores it. */
  missPolicy: MissPolicy;
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
    clock: recurrence.clock,
    miss_policy: recurrence.missPolicy,
  };
}

/** A blank Recurrence: continuous, open-ended, Window + Archive. */
export function defaultRecurrence(startDate: string): RecurrenceUi {
  return {
    isHabit: false,
    startDate,
    gapEnabled: false,
    gapN: 1,
    gapKind: "day",
    endEnabled: false,
    endDate: startDate,
    clock: "window",
    missPolicy: "archive",
  };
}

/** How often a Habit's windows come, as its collapsed summary names it. */
export type RecurrenceCadence = "day" | "week" | "month" | "season" | "unscoped";

/** What the collapsed Recurrence summary says, before it is put into words. */
export interface RecurrenceSummaryParts {
  /** The window's kind — a sub-day (Phase) window recurs daily — or `unscoped`. */
  cadence: RecurrenceCadence;
  /** How many of `cadence` one window spans (1 for a sub-day or Unscoped flow). */
  cadenceCount: number;
  clock: ClockKind;
  /** The miss policy, only under a Window clock. */
  missPolicy: MissPolicy | null;
  /** The Gap, or `null` for none. */
  gap: { n: number; kind: string } | null;
  /** The last anchor's start day, or `null` for open-ended. */
  endDate: string | null;
}

/**
 * The settings the collapsed Recurrence line summarises ("Weekly · Window, Overdue · gap 2 week ·
 * ends never"): what the editor would save, so an Unscoped flow reads as Interval whatever the
 * pills last held, and a Window clock alone carries a miss policy.
 */
export function recurrenceSummaryParts(
  recurrence: RecurrenceUi,
  durationKind: string | null,
  durationN: number,
  scoped: boolean,
): RecurrenceSummaryParts {
  const clock: ClockKind = scoped ? recurrence.clock : "interval";
  const cadence: RecurrenceCadence = !scoped
    ? "unscoped"
    : durationKind === "week" || durationKind === "month" || durationKind === "season"
      ? durationKind
      : "day";
  const phase = durationKind === "part" || durationKind === "exact";
  return {
    cadence,
    cadenceCount: !scoped || phase ? 1 : Math.max(1, durationN),
    clock,
    missPolicy: clock === "window" ? recurrence.missPolicy : null,
    gap: recurrence.gapEnabled ? { n: recurrence.gapN, kind: recurrence.gapKind } : null,
    endDate: recurrence.endEnabled ? recurrence.endDate : null,
  };
}
