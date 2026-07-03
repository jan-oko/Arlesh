export const CONTEXT_ACTION = {
  ENTER: "enter",
  RENAME: "rename",
  TYPE_UP: "type-up",
  TYPE_DOWN: "type-down",
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

export type ContextMenuAction = typeof CONTEXT_ACTION[keyof typeof CONTEXT_ACTION];
