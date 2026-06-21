import { useCallback, useEffect, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { computeLayout } from "@/utils/tree-layout";
import { nextType, prevType, crossesGoalTaskBoundary } from "@/utils/node-meta";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "@/utils/status-mapping";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { ContextMenuAction } from "./NodeContextMenu";
import { addTagToTask, removeTagFromTask } from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal } from "@/api/goals";
import { listDomains } from "@/api/domains";
import type { Domain } from "@/api/domains";
import MindmapCanvas from "./MindmapCanvas";
import SubtreeNavPill from "./SubtreeNavPill";
import StatusToast from "./StatusToast";
import NodeEditorModal from "./NodeEditorModal";
import styles from "./MindmapView.module.css";

export default function MindmapView() {
  const { tree, isLoading, error, createChild, renameNode, retypeNode, moveNode, removeNode, reload } =
    useMindmapData();

  const {
    selectedNodeId,
    subtreeRootId,
    clipboard,
    collapsedNodeIds,
    pendingToast,
    selectNode,
    enterSubtree,
    exitSubtree,
    exitToRoot,
    setClipboard,
    toggleCollapsed,
    showToast,
    clearToast,
  } = useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [editorModal, setEditorModal] = useState<{ nodeId: string; node: MindmapNode } | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);

  useEffect(() => {
    void listDomains("tag").then(setAllTags);
  }, []);

  const displayRoot: MindmapNode = subtreeRootId !== null
    ? (findNode(tree, subtreeRootId) ?? tree)
    : tree;

  const positions = computeLayout(displayRoot, collapsedNodeIds);

  const findNodeById = useCallback(
    (id: string): MindmapNode | undefined => findNode(tree, id),
    [tree],
  );

  const navigateArrow = useCallback(
    (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => {
      if (selectedNodeId === null) return;

      // Up/Down: navigate siblings sorted by visual Y (matches rendered order)
      if (key === "ArrowUp" || key === "ArrowDown") {
        const parent = findParent(displayRoot, selectedNodeId);
        if (parent === null) return;
        const sorted = [...parent.children].sort(
          (a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0),
        );
        const index = sorted.findIndex((c) => c.id === selectedNodeId);
        const next = sorted[index + (key === "ArrowUp" ? -1 : 1)];
        if (next !== undefined) selectNode(next.id);
        return;
      }

      // Left/Right: "away from center" = deeper, "toward center" = parent.
      // For root (x=0): Right → nearest right child, Left → nearest left child.
      const pos = positions.get(selectedNodeId);
      const nodeX = pos?.x ?? 0;
      const currentY = pos?.y ?? 0;
      const movingRight = key === "ArrowRight";

      if (nodeX === 0) {
        // Root: step to the child on the matching side closest in Y
        const node = findNode(displayRoot, selectedNodeId);
        if (node === undefined) return;
        const sideChildren = node.children.filter((c) => {
          const cx = positions.get(c.id)?.x ?? 0;
          return movingRight ? cx > 0 : cx < 0;
        });
        const closest = sideChildren.reduce<MindmapNode | undefined>((best, child) => {
          if (best === undefined) return child;
          return Math.abs((positions.get(child.id)?.y ?? 0) - currentY) <
            Math.abs((positions.get(best.id)?.y ?? 0) - currentY)
            ? child
            : best;
        }, undefined);
        if (closest !== undefined) selectNode(closest.id);
        return;
      }

      const goingDeeper = movingRight === (nodeX > 0);

      if (goingDeeper) {
        const node = findNode(displayRoot, selectedNodeId);
        if (node === undefined || node.children.length === 0) return;
        const closest = node.children.reduce((best, child) =>
          Math.abs((positions.get(child.id)?.y ?? 0) - currentY) <
          Math.abs((positions.get(best.id)?.y ?? 0) - currentY)
            ? child
            : best,
        );
        selectNode(closest.id);
      } else {
        const parent = findParent(displayRoot, selectedNodeId);
        if (parent !== null) selectNode(parent.id);
      }
    },
    [selectedNodeId, positions, displayRoot, selectNode],
  );

  // Must be defined before handleKeyDown which references it
  const cycleType = useCallback(
    (nodeId: string, direction: 1 | -1) => {
      const node = findNodeById(nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const newKind: NodeKind = direction === 1 ? nextType(node.kind) : prevType(node.kind);
      if (crossesGoalTaskBoundary(node.kind, newKind)) {
        const newStatus =
          node.kind === "goal"
            ? goalStatusToTaskStatus(node.status ?? "active")
            : taskStatusToGoalStatus(node.status ?? "todo");
        showToast({ nodeId, message: `Status: ${node.status ?? "—"} → ${newStatus}` });
      }
      void retypeNode(nodeId, node.kind, newKind);
    },
    [findNodeById, showToast, retypeNode],
  );

  // Must be defined before handleKeyDown which references it
  const pasteClipboard = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const sourceNode = findNodeById(clipboard.nodeId);
      const targetNode = findNodeById(targetId);
      if (sourceNode === undefined || targetNode === undefined) return;
      void moveNode(clipboard.nodeId, sourceNode.kind, targetId, targetNode.kind).then(() => {
        if (clipboard.operation === "cut") setClipboard(null);
      });
    },
    [clipboard, findNodeById, moveNode, setClipboard],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (editingNodeId !== null) return;
      if (editorModal !== null) return;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) {
            cycleType(selectedNodeId, -1);
          } else {
            navigateArrow("ArrowLeft");
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) {
            cycleType(selectedNodeId, 1);
          } else {
            navigateArrow("ArrowRight");
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          navigateArrow("ArrowUp");
          break;
        case "ArrowDown":
          event.preventDefault();
          navigateArrow("ArrowDown");
          break;
        case "Tab":
          event.preventDefault();
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind !== "aspect") {
              void (async () => {
                const newNode = await createChild(selectedNodeId, node.kind, "");
                setEditingNodeId(newNode.id);
              })();
            }
          }
          break;
        case "Delete":
          if (selectedNodeId !== null) {
            event.preventDefault();
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
              void removeNode(selectedNodeId, node.kind).then(() => selectNode(null));
            }
          }
          break;
        case "/":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            toggleCollapsed(selectedNodeId);
          }
          break;
        case "Escape":
          if (subtreeRootId !== null) {
            event.preventDefault();
            exitSubtree();
          }
          break;
        case "x":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            setClipboard({ operation: "cut", nodeId: selectedNodeId });
          }
          break;
        case "c":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            setClipboard({ operation: "copy", nodeId: selectedNodeId });
          }
          break;
        case "v":
          if (event.ctrlKey && clipboard !== null && selectedNodeId !== null) {
            event.preventDefault();
            pasteClipboard(selectedNodeId);
          }
          break;
      }
    },
    [
      editingNodeId,
      editorModal,
      selectedNodeId,
      navigateArrow,
      cycleType,
      findNodeById,
      createChild,
      removeNode,
      selectNode,
      toggleCollapsed,
      subtreeRootId,
      exitSubtree,
      clipboard,
      setClipboard,
      pasteClipboard,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    function handleShiftEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && event.shiftKey) exitToRoot();
    }
    window.addEventListener("keydown", handleShiftEscape);
    return () => window.removeEventListener("keydown", handleShiftEscape);
  }, [exitToRoot]);

  const handleContextAction = useCallback(
    (nodeId: string, action: ContextMenuAction) => {
      const node = findNodeById(nodeId);
      if (node === undefined) return;

      switch (action) {
        case "enter":
          enterSubtree(nodeId);
          break;
        case "rename":
          setEditingNodeId(nodeId);
          break;
        case "type-up":
          cycleType(nodeId, 1);
          break;
        case "type-down":
          cycleType(nodeId, -1);
          break;
        case "cut":
          setClipboard({ operation: "cut", nodeId });
          break;
        case "copy":
          setClipboard({ operation: "copy", nodeId });
          break;
        case "paste":
          if (clipboard !== null) pasteClipboard(nodeId);
          break;
        case "collapse":
        case "expand":
          toggleCollapsed(nodeId);
          break;
        case "delete":
          if (node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
            void removeNode(nodeId, node.kind).then(() => selectNode(null));
          }
          break;
      }
    },
    [
      findNodeById,
      enterSubtree,
      cycleType,
      setClipboard,
      clipboard,
      pasteClipboard,
      toggleCollapsed,
      removeNode,
      selectNode,
    ],
  );

  const handleDoubleClick = useCallback(
    (nodeId: string) => {
      const node = findNodeById(nodeId);
      if (node === undefined || node.kind === "aspect") return;
      setEditorModal({ nodeId, node });
    },
    [findNodeById],
  );

  const handleEditorSave = useCallback(
    async (title: string, newTagIds: number[]) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      const isTask = node.kind === "task";
      const isGoal = node.kind === "goal";

      await renameNode(nodeId, node.kind, title);

      const added = newTagIds.filter((id) => !node.tagIds.includes(id));
      const removed = node.tagIds.filter((id) => !newTagIds.includes(id));
      for (const tagId of added) {
        if (isTask) await addTagToTask(dbId, tagId);
        else if (isGoal) await addTagToGoal(dbId, tagId);
      }
      for (const tagId of removed) {
        if (isTask) await removeTagFromTask(dbId, tagId);
        else if (isGoal) await removeTagFromGoal(dbId, tagId);
      }

      await reload();
      setEditorModal(null);
    },
    [editorModal, renameNode, reload],
  );

  const handleCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") {
        setEditingNodeId(null);
        return;
      }
      const node = findNodeById(nodeId);
      if (node !== undefined) {
        void renameNode(nodeId, node.kind, title.trim()).then(() => setEditingNodeId(null));
      }
    },
    [findNodeById, renameNode],
  );

  const handleDrop = useCallback(
    (targetId: string) => {
      if (dragSourceId === null || dragSourceId === targetId) return;
      const source = findNodeById(dragSourceId);
      const target = findNodeById(targetId);
      if (source === undefined || target === undefined) return;
      if (target.kind === "aspect" || target.kind === "task") return;
      void moveNode(dragSourceId, source.kind, targetId, target.kind);
      setDragSourceId(null);
      setDragTargetId(null);
    },
    [dragSourceId, findNodeById, moveNode],
  );

  const subtreeParent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const toastPosition = pendingToast !== null ? positions.get(pendingToast.nodeId) : undefined;

  if (isLoading) {
    return <div className={styles.centered}>Loading…</div>;
  }

  if (error !== null) {
    return <div className={styles.centered}>Error: {error}</div>;
  }

  return (
    <div className={styles.container}>
      <MindmapCanvas
        root={displayRoot}
        collapsedNodeIds={collapsedNodeIds}
        selectedNodeId={selectedNodeId}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        hasClipboard={clipboard !== null}
        onSelect={selectNode}
        onDoubleClick={handleDoubleClick}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={handleContextAction}
        onDragStart={(id) => { setDragSourceId(id); setDragTargetId(null); }}
        onDrop={handleDrop}
        onCanvasClick={() => selectNode(null)}
      />

      {subtreeRootId !== null && (
        <SubtreeNavPill
          parentTitle={subtreeParent?.title ?? "Arlesh"}
          onBack={exitSubtree}
        />
      )}

      {pendingToast !== null && toastPosition !== undefined && (
        <StatusToast
          message={pendingToast.message}
          position={toastPosition}
          onDismiss={clearToast}
        />
      )}

      {editorModal !== null && (
        <NodeEditorModal
          nodeId={editorModal.nodeId}
          title={editorModal.node.title}
          tagIds={editorModal.node.tagIds}
          allTags={allTags}
          onSave={(title, tagIds) => { void handleEditorSave(title, tagIds); }}
          onClose={() => setEditorModal(null)}
        />
      )}
    </div>
  );
}

function findNode(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParent(root: MindmapNode, id: string): MindmapNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found !== null) return found;
  }
  return null;
}
