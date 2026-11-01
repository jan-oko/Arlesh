import type { TouchLabelKey } from "@/stores/use-command-surface-store";

/**
 * The touch gestures, in one list (`docs/spec/touch.md`). Two things read it: the cheat sheet,
 * which shows these instead of the keyboard's shortcuts on a touch-only device, and
 * `gesture-list.test.ts`, which holds the spec's gesture table to the same rows, word for word. A
 * gesture added here therefore has to be written into `touch.md`, and the other way round.
 */
export type GestureScope = "all" | "mindmap" | "list" | "plan" | "steps" | "zen";

/** One gesture and what it does, as keys into the `touch` strings. */
export interface GestureEntry {
  id: string;
  scope: GestureScope;
  gestureKey: TouchLabelKey;
  doesKey: TouchLabelKey;
}

/** The scopes in the order the sheet draws them, with the key of each one's name. */
export const GESTURE_SCOPES: ReadonlyArray<{ scope: GestureScope; nameKey: TouchLabelKey }> = [
  { scope: "all", nameKey: "gestureScopeAll" },
  { scope: "mindmap", nameKey: "gestureScopeMindmap" },
  { scope: "list", nameKey: "gestureScopeList" },
  { scope: "plan", nameKey: "gestureScopePlan" },
  { scope: "steps", nameKey: "gestureScopeSteps" },
  { scope: "zen", nameKey: "gestureScopeZen" },
];

export const GESTURES: readonly GestureEntry[] = [
  { id: "tap", scope: "all", gestureKey: "gestureTap", doesKey: "gestureTapDoes" },
  { id: "statusIcon", scope: "all", gestureKey: "gestureStatusIcon", doesKey: "gestureStatusIconDoes" },
  { id: "doubleTap", scope: "all", gestureKey: "gestureDoubleTap", doesKey: "gestureDoubleTapDoes" },
  { id: "longPress", scope: "all", gestureKey: "gestureLongPress", doesKey: "gestureLongPressDoes" },
  { id: "flickUp", scope: "all", gestureKey: "gestureFlickUp", doesKey: "gestureFlickUpDoes" },
  { id: "swipeRight", scope: "all", gestureKey: "gestureSwipeRight", doesKey: "gestureSwipeRightDoes" },
  { id: "swipeLeft", scope: "all", gestureKey: "gestureSwipeLeft", doesKey: "gestureSwipeLeftDoes" },
  { id: "twoFingerSwipe", scope: "all", gestureKey: "gestureTwoFingerSwipe", doesKey: "gestureTwoFingerSwipeDoes" },
  { id: "squareDoubleTap", scope: "all", gestureKey: "gestureSquareDoubleTap", doesKey: "gestureSquareDoubleTapDoes" },
  { id: "squareLongPress", scope: "all", gestureKey: "gestureSquareLongPress", doesKey: "gestureSquareLongPressDoes" },
  { id: "mindmapEnter", scope: "mindmap", gestureKey: "gestureMindmapEnter", doesKey: "gestureMindmapEnterDoes" },
  { id: "mindmapPan", scope: "mindmap", gestureKey: "gestureMindmapPan", doesKey: "gestureMindmapPanDoes" },
  { id: "mindmapMove", scope: "mindmap", gestureKey: "gestureMindmapMove", doesKey: "gestureMindmapMoveDoes" },
  { id: "mindmapDot", scope: "mindmap", gestureKey: "gestureMindmapDot", doesKey: "gestureMindmapDotDoes" },
  { id: "mindmapPinch", scope: "mindmap", gestureKey: "gestureMindmapPinch", doesKey: "gestureMindmapPinchDoes" },
  { id: "listLeaf", scope: "list", gestureKey: "gestureListLeaf", doesKey: "gestureListLeafDoes" },
  { id: "listParent", scope: "list", gestureKey: "gestureListParent", doesKey: "gestureListParentDoes" },
  { id: "planScope", scope: "plan", gestureKey: "gesturePlanScope", doesKey: "gesturePlanScopeDoes" },
  { id: "planUp", scope: "plan", gestureKey: "gesturePlanUp", doesKey: "gesturePlanUpDoes" },
  { id: "planMove", scope: "plan", gestureKey: "gesturePlanMove", doesKey: "gesturePlanMoveDoes" },
  { id: "planEnter", scope: "plan", gestureKey: "gesturePlanEnter", doesKey: "gesturePlanEnterDoes" },
  { id: "stepsEnter", scope: "steps", gestureKey: "gestureStepsEnter", doesKey: "gestureStepsEnterDoes" },
  { id: "stepsPinch", scope: "steps", gestureKey: "gestureStepsPinch", doesKey: "gestureStepsPinchDoes" },
  { id: "zenOpen", scope: "zen", gestureKey: "gestureZenOpen", doesKey: "gestureZenOpenDoes" },
];

/** The gestures of one scope, in the list's order. */
export function gesturesOf(scope: GestureScope): GestureEntry[] {
  return GESTURES.filter((gesture) => gesture.scope === scope);
}
