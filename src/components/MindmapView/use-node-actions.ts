import { useCallback } from "react";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { updateTask } from "@/api/tasks";
import { TASK_STATUS } from "@/utils/status-mapping";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";

const LOG_PREFIX = "[arlesh]";

function nextTaskStatus(current: string): string {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

function lastChildPosition(children: Array<{ id: string; position: number }>, excludeId: string): number {
  const positions = children.filter((c) => c.id !== excludeId).map((c) => c.position);
  return positions.length > 0 ? Math.max(...positions) + 1 : 0;
}

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeId: string;
}

interface Options {
  tree: MindmapNode;
  clipboard: ClipboardEntry | null;
  moveNode: (id: string, kind: NodeKind, parentId: string, parentKind: NodeKind, position: number) => Promise<void>;
  onRequestDelete: (nodeId: string) => void;
  reload: () => Promise<void>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  selectNode: (id: string | null) => void;
  setClipboard: (entry: ClipboardEntry | null) => void;
  setEditingNodeId: (id: string | null) => void;
}

interface Result {
  onStatusClick: (nodeId: string) => void;
  onCommitEdit: (nodeId: string, title: string) => void;
  onCreateChild: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPaste: (targetId: string) => void;
}

export function useNodeActions({
  tree, clipboard, moveNode, onRequestDelete, reload, renameNode,
  createChild, selectNode, setClipboard, setEditingNodeId,
}: Options): Result {
  const onStatusClick = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind !== "task") return;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) })
        .then(() => reload())
        .catch((err: unknown) => console.error(`${LOG_PREFIX} status cycle failed:`, err));
    },
    [tree, reload],
  );

  const onCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") { setEditingNodeId(null); return; }
      const node = findNode(tree, nodeId);
      if (node !== undefined) {
        void renameNode(nodeId, node.kind, title.trim()).then(() => setEditingNodeId(null));
      }
    },
    [tree, renameNode, setEditingNodeId],
  );

  const onCreateChild = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || !nodeId.includes("-") || node.kind === "tag") return;
      void (async () => {
        try {
          const newNode = await createChild(nodeId, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} createChild failed:`, err);
        }
      })();
    },
    [tree, createChild, selectNode, setEditingNodeId],
  );

  const onDelete = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node !== undefined && node.kind !== "aspect") {
        onRequestDelete(nodeId);
      }
    },
    [tree, onRequestDelete],
  );

  const onPaste = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const sourceNode = findNode(tree, clipboard.nodeId);
      const targetNode = findNode(tree, targetId);
      if (sourceNode === undefined || targetNode === undefined) return;
      const position = lastChildPosition(targetNode.children, clipboard.nodeId);
      void moveNode(clipboard.nodeId, sourceNode.kind, targetId, targetNode.kind, position).then(() => {
        if (clipboard.operation === CLIPBOARD_OP.CUT) setClipboard(null);
      });
    },
    [clipboard, tree, moveNode, setClipboard],
  );

  return { onStatusClick, onCommitEdit, onCreateChild, onDelete, onPaste };
}
