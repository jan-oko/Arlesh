// Carrying a Plan View selection on a drag.
//
// Drag and the keyboard plan the **same rows**: a drag that starts on a selected card carries the
// whole selection, and one that starts anywhere else selects that card first. So the two gestures
// never disagree about what is being moved, and neither of them owns a mode the other has to leave.

import type { PlanPane } from "@/utils/hotkeys/plan/selection";

/**
 * A private drag type, so the panes accept their own drags and nothing else. A file dragged in from
 * the desktop carries `Files`, a text selection carries `text/plain`; neither names a task, and a
 * drop target that took them would be planning whatever happened to be under the pointer.
 */
export const PLAN_DRAG_TYPE = "application/x-arlesh-plan-rows";

/** What a drag is carrying. */
export interface PlanDragPayload {
  /** The pane the rows were dragged out of — which says whether a drop is a plan or a move. */
  pane: PlanPane;
  ids: string[];
}

/** Puts the dragged rows on the transfer. */
export function writePlanDrag(transfer: DataTransfer, payload: PlanDragPayload): void {
  transfer.effectAllowed = "move";
  transfer.setData(PLAN_DRAG_TYPE, JSON.stringify(payload));
  // A plain-text fallback so a drag that escapes the app is a list of ids rather than nothing.
  transfer.setData("text/plain", payload.ids.join(" "));
}

/** Whether a drag in flight is one of ours, which is all a drop target can know before the drop. */
export function isPlanDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes(PLAN_DRAG_TYPE);
}

/** Reads the dragged rows back, or `null` for a drag that is not ours or is malformed. */
export function readPlanDrag(transfer: DataTransfer | null): PlanDragPayload | null {
  if (transfer === null) return null;
  const raw = transfer.getData(PLAN_DRAG_TYPE);
  if (raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const pane = "pane" in parsed ? parsed.pane : undefined;
    const ids = "ids" in parsed ? parsed.ids : undefined;
    if (pane !== "candidates" && pane !== "planned") return null;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return null;
    return { pane, ids: ids.filter((id): id is string => typeof id === "string") };
  } catch {
    // A payload we wrote is always valid JSON; one that is not came from somewhere else.
    return null;
  }
}

/** The `touchOver` key of a pane taken as a whole (a section is keyed by its own `key`). */
export const PLAN_WHOLE_PANE = "pane";

/** Where a finger's drag is hovering: a pane, and the bucket in it, if any. */
export interface PlanDropPoint {
  pane: PlanPane;
  /** The bucket's `key`, or `null` for the pane at large. */
  section: string | null;
}

/**
 * The drop target under a point, read from the panes' own data attributes — the touch drag's
 * answer to the mouse's `dragover`. A bucket wins over the pane around it.
 */
export function planDropPointAt(x: number, y: number): PlanDropPoint | null {
  const element = document.elementFromPoint(x, y);
  if (element === null) return null;
  const paneElement = element.closest("[data-plan-pane]");
  const side = paneElement?.getAttribute("data-plan-pane");
  if (side !== "candidates" && side !== "planned") return null;
  const section = element.closest("[data-plan-section]")?.getAttribute("data-plan-section") ?? null;
  return { pane: side, section };
}
