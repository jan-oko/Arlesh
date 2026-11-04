export const CONTEXT_ACTION = {
  ENTER: "enter",
  /** Opens the node's editor: the action bar's Edit, which full screen hides. */
  EDIT: "edit",
  RENAME: "rename",
  CUT: "cut",
  COPY: "copy",
  PASTE: "paste",
  COLLAPSE: "collapse",
  EXPAND: "expand",
  NEW_FLOW: "new-flow",
  CONVERT_TO_FLOW: "convert-to-flow",
  START_FLOW: "start-flow",
  /** Archive by hand, or unarchive the node archived — whichever the menu offered. */
  ARCHIVE: "archive",
  DELETE: "delete",
} as const;

export type ContextMenuAction = typeof CONTEXT_ACTION[keyof typeof CONTEXT_ACTION];
