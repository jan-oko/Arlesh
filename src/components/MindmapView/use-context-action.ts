import { useCallback } from "react";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";
import { CONTEXT_ACTION, SET_TYPE_PREFIX } from "@/components/NodeContextMenu/context-action";
import { CLIPBOARD_OP } from "@/stores/use-clipboard-store";
import type { OccurrenceMenuAction } from "@/utils/occurrence-menu";
import { isOccurrenceMenuAction } from "@/utils/occurrence-menu";

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

interface Options {
  findNodeById: (id: string) => MindmapNode | undefined;
  enterSubtree: (id: string) => void;
  setEditingNodeId: (id: string | null) => void;
  setType: (nodeId: string, kind: NodeKind) => void;
  setClipboard: (entry: ClipboardEntry | null) => void;
  clipboard: ClipboardEntry | null;
  onPaste: (targetId: string) => void;
  toggleCollapsed: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onNewFlow: (parentId: string) => void;
  onConvertToFlow: (nodeId: string) => void;
  onStartFlow: (flowId: string) => void;
  /** Runs an entry of a virtual Habit node's own menu. */
  onOccurrenceAction: (node: MindmapNode, action: OccurrenceMenuAction) => void;
}

interface Result {
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
}

export function useContextAction({
  findNodeById, enterSubtree, setEditingNodeId, setType,
  setClipboard, clipboard, onPaste, toggleCollapsed, onDelete, onNewFlow, onConvertToFlow, onStartFlow,
  onOccurrenceAction,
}: Options): Result {
  const onContextAction = useCallback(
    (nodeId: string, action: ContextMenuAction) => {
      const node = findNodeById(nodeId);
      if (node === undefined) return;
      // A Habit occurrence's menu is its own, and so is what its entries do.
      if (node.habitItem !== undefined && isOccurrenceMenuAction(action)) {
        onOccurrenceAction(node, action);
        return;
      }
      // "Set type" submenu picks arrive as `set-type:<kind>`.
      if (action.startsWith(SET_TYPE_PREFIX)) {
        const kind = action.slice(SET_TYPE_PREFIX.length);
        if (isNodeKind(kind)) setType(nodeId, kind);
        return;
      }
      switch (action) {
        case CONTEXT_ACTION.ENTER: enterSubtree(nodeId); break;
        case CONTEXT_ACTION.RENAME: setEditingNodeId(nodeId); break;
        case CONTEXT_ACTION.CUT: setClipboard({ operation: CLIPBOARD_OP.CUT, nodeIds: [nodeId] }); break;
        case CONTEXT_ACTION.COPY: setClipboard({ operation: CLIPBOARD_OP.COPY, nodeIds: [nodeId] }); break;
        case CONTEXT_ACTION.PASTE: if (clipboard !== null) onPaste(nodeId); break;
        case CONTEXT_ACTION.COLLAPSE: case CONTEXT_ACTION.EXPAND: toggleCollapsed(nodeId); break;
        case CONTEXT_ACTION.NEW_FLOW: onNewFlow(nodeId); break;
        case CONTEXT_ACTION.CONVERT_TO_FLOW: onConvertToFlow(nodeId); break;
        case CONTEXT_ACTION.START_FLOW: onStartFlow(nodeId); break;
        case CONTEXT_ACTION.DELETE: onDelete([nodeId]); break;
      }
    },
    [findNodeById, enterSubtree, setEditingNodeId, setType, setClipboard, clipboard, onPaste, toggleCollapsed, onDelete, onNewFlow, onConvertToFlow, onStartFlow, onOccurrenceAction],
  );

  return { onContextAction };
}
