import type { NodeKind } from "@/utils/tree-layout";

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

export type ContextMenuAction = typeof CONTEXT_ACTION[keyof typeof CONTEXT_ACTION] | SetTypeAction;
