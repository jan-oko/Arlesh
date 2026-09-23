import type { NodeKind } from "@/utils/tree-layout";
import type { OccurrenceMenuAction } from "@/utils/occurrence-menu";

export const CONTEXT_ACTION = {
  ENTER: "enter",
  RENAME: "rename",
  CUT: "cut",
  COPY: "copy",
  PASTE: "paste",
  COLLAPSE: "collapse",
  EXPAND: "expand",
  NEW_FLOW: "new-flow",
  CONVERT_TO_FLOW: "convert-to-flow",
  START_FLOW: "start-flow",
  DELETE: "delete",
} as const;

/** "Set type" submenu picks encode the target kind in the action string (e.g. `set-type:goal`). */
export type SetTypeAction = `set-type:${NodeKind}`;

export const SET_TYPE_PREFIX = "set-type:";

/**
 * Every action a node's context menu can send — including a Habit occurrence's own menu, whose
 * entries arrive through the same route and are handed to the occurrence handler.
 */
export type ContextMenuAction =
  | typeof CONTEXT_ACTION[keyof typeof CONTEXT_ACTION]
  | SetTypeAction
  | OccurrenceMenuAction;
