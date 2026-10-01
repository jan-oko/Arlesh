import type { ClockKind, CooldownKind, MissPolicy, SetRecurrenceRequest } from "@/api/flows";
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
  /** A Window Habit's cooldown — saved only under a Window clock, and only while enabled. */
  cooldownEnabled: boolean;
  cooldownN: number;
  cooldownKind: CooldownKind;
}

/**
 * The units a Habit whose window is of `durationKind` may count a cooldown in: the kinds below its
 * own — a daily Habit's parts of the day, a weekly one's days, a monthly one's weeks or days, a
 * seasonal one's months, weeks or days. Empty for a sub-day (Phase) or unscoped window. Mirrors
 * the backend's `CooldownUnit::allowed_for`.
 */
export function cooldownKinds(durationKind: string | null): CooldownKind[] {
  switch (durationKind) {
    case "day": return ["part"];
    case "week": return ["day"];
    case "month": return ["week", "day"];
    case "season": return ["month", "week", "day"];
    default: return [];
  }
}

/** The fewest days a window of `durationKind` can hold: a February, a 90-day Winter. */
function shortestDays(durationKind: string): number {
  if (durationKind === "week") return 7;
  if (durationKind === "month") return 28;
  if (durationKind === "season") return 90;
  return 1;
}

/**
 * The longest cooldown, in `kind` units, a window of `durationN` × `durationKind` takes: one that
 * cannot reach the end of the window after the one it follows. A unit that tiles the window stops
 * one short of the shortest such window; a Week, which does not tile a Month or a Season, also
 * gives up the six days the week holding the completion can run into the next window. Mirrors the
 * backend's `Cooldown::fits`, which refuses anything longer.
 */
export function maxCooldown(kind: CooldownKind, durationKind: string, durationN: number): number {
  const n = Math.max(1, durationN);
  const room = kind === "part" ? 6 * n : kind === "month" ? 3 * n : shortestDays(durationKind) * n;
  if (kind === "week") return Math.max(0, Math.ceil((room - 6) / 7) - 1);
  return room - 1;
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
    cooldown_n: recurrence.cooldownN,
    cooldown_kind: recurrence.cooldownKind,
  };
}

/** A cooldown as it is shown and saved: a count and a unit, or none. */
export interface CooldownChoice {
  cooldownN: number | null;
  cooldownKind: CooldownKind | null;
}

/**
 * The cooldown `recurrence` stands for under a window of `durationN` × `durationKind`: none unless
 * it is switched on under a Window clock on a window that takes one. A unit the window no longer
 * takes reads as the first one it does, and a count past the longest it takes reads as that
 * longest — so what the field shows is exactly what is saved.
 */
export function effectiveCooldown(
  recurrence: RecurrenceUi,
  clock: ClockKind,
  durationKind: string | null,
  durationN: number,
): CooldownChoice {
  const kinds = cooldownKinds(durationKind);
  const fallback = kinds[0];
  if (!recurrence.cooldownEnabled || clock !== "window" || durationKind === null || fallback === undefined) {
    return { cooldownN: null, cooldownKind: null };
  }
  const kind = kinds.includes(recurrence.cooldownKind) ? recurrence.cooldownKind : fallback;
  const max = maxCooldown(kind, durationKind, durationN);
  if (max < 1) return { cooldownN: null, cooldownKind: null };
  return { cooldownN: Math.min(Math.max(1, recurrence.cooldownN), max), cooldownKind: kind };
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
    cooldownEnabled: false,
    cooldownN: 1,
    cooldownKind: "day",
  };
}
