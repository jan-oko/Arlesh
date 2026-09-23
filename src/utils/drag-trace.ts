/**
 * TEMPORARY: a trace of every step a tab takes between windows, for diagnosing the drag on
 * WebKitGTK/Wayland from a user's run. Remove once the cross-window drag is confirmed working.
 *
 * Read it in each window's Web Inspector (right-click an empty part of the tab strip → Inspect
 * Element → Console), filtered on `arlesh:drag`. Every line carries the window it was logged in,
 * so the source's and the target's consoles can be laid side by side.
 */

import { currentWindowLabel } from "@/api/window-label";

/** Logs one step of a tab's journey between windows. */
export function traceDrag(step: string, fields: Record<string, unknown> = {}): void {
  console.info("[arlesh:drag]", step, { window: currentWindowLabel(), at: performance.now(), ...fields });
}
