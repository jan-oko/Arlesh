import type { BindingMeta } from "@/utils/hotkeys/chord";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";

/**
 * The gestures that stand in for a binding the palette leaves out (`docs/spec/touch.md`). A binding
 * is left out only when a finger already does what its key does, and more directly.
 */
export const TOUCH_GESTURES = ["tap", "panCanvas", "scroll", "presetSheet"] as const;

/** One of the gestures in `TOUCH_GESTURES`. */
export type TouchGesture = (typeof TOUCH_GESTURES)[number];

interface PaletteExclusion {
  /** Matches a binding id exactly, or every id that starts with it when it ends in a dot. */
  idPattern: string;
  gesture: TouchGesture;
}

/**
 * The bindings the palette leaves out, each with the gesture that replaces it. Everything else in
 * the registry is a palette entry — `palette-coverage.test.ts` holds that, so a new binding is in
 * the palette unless someone names the gesture that makes it redundant.
 */
export const PALETTE_EXCLUSIONS: readonly PaletteExclusion[] = [
  // Moving the selection one step: a tap selects the node itself.
  { idPattern: "mindmap.navigate.", gesture: "tap" },
  { idPattern: "mindmap.navigateShift.", gesture: "tap" },
  { idPattern: "listView.navigateUp", gesture: "tap" },
  { idPattern: "listView.navigateDown", gesture: "tap" },
  { idPattern: "planView.navigateUp", gesture: "tap" },
  { idPattern: "planView.navigateDown", gesture: "tap" },
  { idPattern: "stepsView.navigate.", gesture: "tap" },
  { idPattern: "zenView.navigate.", gesture: "tap" },
  // The Mindmap's arrow-key pan: one finger on empty canvas.
  { idPattern: "mindmap.pan.", gesture: "panCanvas" },
  { idPattern: "mindmap.panShift.", gesture: "panCanvas" },
  // Roaming the viewport without moving the selection: the list scrolls under the finger.
  { idPattern: "listView.scrollUp", gesture: "scroll" },
  { idPattern: "listView.scrollDown", gesture: "scroll" },
  { idPattern: "zenView.scrollUp", gesture: "scroll" },
  { idPattern: "zenView.scrollDown", gesture: "scroll" },
  // The refusals of a view that locks its preset: they change nothing and say why, which the preset
  // chip's sheet already says beside the locked options.
  { idPattern: "planView.status.", gesture: "presetSheet" },
  { idPattern: "zenView.status.", gesture: "presetSheet" },
];

function matchesPattern(id: string, pattern: string): boolean {
  return pattern.endsWith(".") ? id.startsWith(pattern) : id === pattern;
}

/** The gesture that replaces a binding the palette leaves out, or `null` for a palette entry. */
export function replacingGesture(id: string): TouchGesture | null {
  return PALETTE_EXCLUSIONS.find((exclusion) => matchesPattern(id, exclusion.idPattern))?.gesture ?? null;
}

/**
 * Families of bindings that share one cheat-sheet line but are each their own action: the Plan
 * View's subscope keys, one per bucket. The sheet lists the first of each family and hides the rest;
 * the palette lists every member that can act, since only the buckets on screen can.
 */
export const PALETTE_FAMILIES: readonly string[] = ["planView.subscope."];

/** Whether a binding is a member of a family in `PALETTE_FAMILIES`. */
export function isFamilyMember(id: string): boolean {
  return PALETTE_FAMILIES.some((prefix) => id.startsWith(prefix));
}

/**
 * Whether a binding is reachable without a keyboard: it is a palette entry, a gesture replaces it,
 * or it is a hidden alias of a binding in the same table that is one of those (the numpad zoom
 * beside `+`, `Ctrl+Y` beside `Ctrl+Shift+Z`).
 */
export function isReachableByTouch(binding: BindingMeta, table: readonly BindingMeta[]): boolean {
  if (replacingGesture(binding.id) !== null) return true;
  if (binding.hidden !== true || isFamilyMember(binding.id)) return true;
  return table.some((other) =>
    other.hidden !== true && other.section === binding.section && other.labelKey === binding.labelKey);
}

/** What makes two rows one action: the same words in the same table — or, in a family, the id. */
function rowIdentity(command: SurfaceCommand): string {
  if (isFamilyMember(command.id)) return command.id;
  return `${command.section}:${command.label.namespace}:${command.label.key}`;
}

/**
 * The palette's rows: every published command that can act now, less the hidden aliases and the
 * bindings a gesture replaces, one row per action — bindings that share a label in one table
 * collapse into their first runnable member, except a family's, which are each their own. The tab
 * chords are left out where the tab strip is not drawn, since a tab nobody can see is not one to
 * open.
 */
export function paletteEntries(commands: readonly SurfaceCommand[], options: { showTabs: boolean }): SurfaceCommand[] {
  const seen = new Set<string>();
  const entries: SurfaceCommand[] = [];
  for (const command of commands) {
    if (command.hidden && !isFamilyMember(command.id)) continue;
    if (replacingGesture(command.id) !== null) continue;
    if (!options.showTabs && command.section === "tabs") continue;
    const identity = rowIdentity(command);
    if (seen.has(identity) || !command.canRun()) continue;
    seen.add(identity);
    entries.push(command);
  }
  return entries;
}
