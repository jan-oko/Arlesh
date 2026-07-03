import { useCallback } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";
import { CONTEXT_ACTION } from "@/components/NodeContextMenu/context-action";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

interface Options {
  findNodeById: (id: string) => MindmapNode | undefined;
  enterSubtree: (id: string) => void;
  setEditingNodeId: (id: string | null) => void;
  cycleType: (nodeId: string, direction: 1 | -1) => void;
  setClipboard: (entry: ClipboardEntry | null) => void;
  clipboard: ClipboardEntry | null;
  onPaste: (targetId: string) => void;
  toggleCollapsed: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onNewFlow: (parentId: string) => void;
  onConvertToFlow: (nodeId: string) => void;
  onStartFlow: (flowId: string) => void;
}

interface Result {
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
}

export function useContextAction({
  findNodeById, enterSubtree, setEditingNodeId, cycleType,
  setClipboard, clipboard, onPaste, toggleCollapsed, onDelete, onNewFlow, onConvertToFlow, onStartFlow,
}: Options): Result {
  const onContextAction = useCallback(
    (nodeId: string, action: ContextMenuAction) => {
      if (findNodeById(nodeId) === undefined) return;
      switch (action) {
        case CONTEXT_ACTION.ENTER: enterSubtree(nodeId); break;
        case CONTEXT_ACTION.RENAME: setEditingNodeId(nodeId); break;
        case CONTEXT_ACTION.TYPE_UP: cycleType(nodeId, 1); break;
        case CONTEXT_ACTION.TYPE_DOWN: cycleType(nodeId, -1); break;
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
    [findNodeById, enterSubtree, setEditingNodeId, cycleType, setClipboard, clipboard, onPaste, toggleCollapsed, onDelete, onNewFlow, onConvertToFlow, onStartFlow],
  );

  return { onContextAction };
}
