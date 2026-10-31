import type { BindingMeta } from "@/utils/hotkeys/chord";
import type { SurfaceCommand, TouchLabelKey } from "@/stores/use-command-surface-store";

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
 * View's subscope keys, one per bucket, and the tab jumps, one per position. The sheet lists the
 * first of each family and hides the rest; the palette lists every member that can act.
 */
export const PALETTE_FAMILIES: readonly string[] = ["planView.subscope.", "tabs.jump"];

/** Whether a binding is a member of a family in `PALETTE_FAMILIES`. */
export function isFamilyMember(id: string): boolean {
  return PALETTE_FAMILIES.some((prefix) => id.startsWith(prefix));
}

/**
 * Bindings the cheat-sheet lists but that only give a second key to another binding's action — the
 * numpad zoom beside `+`, `F2` beside `R`, the Steps View's `[` `]` beside its page keys. A hidden
 * binding outside a family is an alias too. The palette lists the action once, under its first key.
 */
export const PALETTE_ALIASES: ReadonlySet<string> = new Set([
  "mindmap.zoomInNumpad", "mindmap.zoomOutNumpad", "mindmap.renameF2",
  "stepsView.pagePreviousBracket", "stepsView.pageNextBracket",
]);

/** Whether a binding only duplicates another's action under a second key. */
export function isAlias(binding: { id: string; hidden?: boolean }): boolean {
  return (binding.hidden === true && !isFamilyMember(binding.id)) || PALETTE_ALIASES.has(binding.id);
}

/**
 * The palette's own words for bindings that share one cheat-sheet line with a sibling doing the
 * opposite — the sheet's row carries both keys, and a palette row carries one, so it must say which
 * way it goes.
 */
export const PALETTE_LABELS: Readonly<Record<string, TouchLabelKey>> = {
  "planView.previousScope": "palettePreviousScope",
  "planView.nextScope": "paletteNextScope",
  "planView.focusCandidates": "paletteFocusCandidates",
  "planView.focusPlanned": "paletteFocusPlanned",
  "stepsView.pagePrevious": "palettePreviousPage",
  "stepsView.pageNext": "paletteNextPage",
  "mindmap.reorderUp": "paletteReorderUp",
  "mindmap.reorderDown": "paletteReorderDown",
  "mindmap.extendSelection.ArrowUp": "paletteExtendUp",
  "mindmap.extendSelection.ArrowDown": "paletteExtendDown",
  "mindmap.extendSelection.ArrowLeft": "paletteExtendLeft",
  "mindmap.extendSelection.ArrowRight": "paletteExtendRight",
  "planView.extendUp": "paletteExtendUp",
  "planView.extendDown": "paletteExtendDown",
};

/**
 * Whether a binding is reachable without a keyboard: a gesture replaces it, it is a palette entry,
 * or it is an alias of a binding in the same table that is one (`isAlias`).
 */
export function isReachableByTouch(binding: BindingMeta, table: readonly BindingMeta[]): boolean {
  if (replacingGesture(binding.id) !== null || !isAlias(binding)) return true;
  return table.some((other) =>
    !isAlias(other) && other.section === binding.section && other.labelKey === binding.labelKey);
}

/** A command with the palette's own words where it has them (`PALETTE_LABELS`). */
function withPaletteLabel(command: SurfaceCommand): SurfaceCommand {
  const key = Object.prototype.hasOwnProperty.call(PALETTE_LABELS, command.id) ? PALETTE_LABELS[command.id] : undefined;
  return key === undefined ? command : { ...command, label: { namespace: "touch", key } };
}

/**
 * The palette's rows: every published command that can act now, one per action — less the aliases
 * and the bindings a gesture replaces. The tab chords are left out where the tab strip is not drawn,
 * since a tab nobody can see is not one to open.
 */
export function paletteEntries(commands: readonly SurfaceCommand[], options: { showTabs: boolean }): SurfaceCommand[] {
  return commands
    .filter((command) => !isAlias(command) && replacingGesture(command.id) === null)
    .filter((command) => options.showTabs || command.section !== "tabs")
    .filter((command) => command.canRun())
    .map(withPaletteLabel);
}
