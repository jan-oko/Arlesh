import { useCallback, useMemo, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import { useMindmapStore, CLIPBOARD_OP } from "@/stores/use-mindmap-store";
import { useDrag } from "@/hooks/use-drag";
import { useCanvasLayout } from "@/hooks/use-canvas-layout";
import { useNodeTypeManager } from "@/hooks/use-node-type-manager";
import { useNodeEditor } from "@/hooks/use-node-editor";
import { useNodeActions } from "@/hooks/use-node-actions";
import { useKeyboardMindmap } from "@/hooks/use-keyboard-mindmap";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode, findParent, nearestInDirection, collectTasksAndGoals } from "@/utils/mindmap-tree";
import { isValidDropTarget } from "@/utils/node-meta";
import type { ContextMenuAction } from "@/components/NodeContextMenu/NodeContextMenu";
import MindmapCanvas from "@/components/MindmapCanvas/MindmapCanvas";
import DragGhost from "@/components/DragGhost/DragGhost";
import DragPlaceholder from "@/components/DragPlaceholder/DragPlaceholder";
import SubtreeNavPill from "@/components/SubtreeNavPill/SubtreeNavPill";
import StatusToast from "@/components/StatusToast/StatusToast";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import styles from "./MindmapView.module.css";

export default function MindmapView() {
  const { tree, isLoading, error, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, reload } =
    useMindmapData();
  const { selectedNodeId, subtreeRootId, clipboard, collapsedNodeIds, pendingToast, selectNode, enterSubtree, exitSubtree, exitToRoot, setClipboard, toggleCollapsed, showToast, clearToast } =
    useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const findNodeById = useCallback((id: string): MindmapNode | undefined => findNode(tree, id), [tree]);
  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);

  const displayRoot = useMemo<MindmapNode>(
    () => (subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree),
    [subtreeRootId, tree],
  );

  const handleDrop = useCallback(
    (nodeId: string, targetId: string) => {
      const source = findNode(tree, nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined || !isValidDropTarget(source.kind, target.kind)) return;
      const siblingPositions = target.children.filter((c) => c.id !== nodeId).map((c) => c.position);
      const lastPos = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      void moveNode(nodeId, source.kind, targetId, target.kind, lastPos);
    },
    [tree, moveNode],
  );

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag(tree, handleDrop);

  const { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos } = useCanvasLayout({
    displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId,
  });

  const { warningModal, setWarningModal, cycleType, retypeActions } = useNodeTypeManager({
    tree, retypeNode, selectNode, showToast,
  });

  const { editorModal, setEditorModal, allTags, availableForDep, onDoubleClick, onTaskSave, onGoalSave, onSimpleSave, onProjectSave } =
    useNodeEditor({ tree, allTasksAndGoals, renameNode, reload });

  const { onStatusClick, onCommitEdit, onCreateChild, onDelete, onPaste } = useNodeActions({
    tree, clipboard, moveNode, removeNode, reload, renameNode,
    createChild, selectNode, setClipboard, setEditingNodeId,
  });

  const navigateArrow = useCallback(
    (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => {
      if (selectedNodeId === null) return;
      const target = nearestInDirection(selectedNodeId, positions, key);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, selectNode],
  );

  const handleContextAction = useCallback(
    (nodeId: string, action: ContextMenuAction) => {
      if (findNodeById(nodeId) === undefined) return;
      switch (action) {
        case "enter": enterSubtree(nodeId); break;
        case "rename": setEditingNodeId(nodeId); break;
        case "type-up": cycleType(nodeId, 1); break;
        case "type-down": cycleType(nodeId, -1); break;
        case "cut": setClipboard({ operation: CLIPBOARD_OP.CUT, nodeId }); break;
        case "copy": setClipboard({ operation: CLIPBOARD_OP.COPY, nodeId }); break;
        case "paste": if (clipboard !== null) onPaste(nodeId); break;
        case "collapse": case "expand": toggleCollapsed(nodeId); break;
        case "delete": onDelete(nodeId); break;
      }
    },
    [findNodeById, enterSubtree, cycleType, setClipboard, clipboard, onPaste, toggleCollapsed, onDelete],
  );

  useKeyboardMindmap({
    isInputActive: editingNodeId !== null || editorModal !== null,
    isWarningActive: warningModal !== null,
    onDismissWarning: () => setWarningModal(null),
    selectedNodeId,
    subtreeRootId,
    clipboard,
    onNavigate: navigateArrow,
    onCycleType: cycleType,
    onReorder: (id, dir) => { void reorderNode(id, dir); },
    onStartRename: setEditingNodeId,
    onCreateChild,
    onDelete,
    onToggleCollapsed: toggleCollapsed,
    onExitSubtree: exitSubtree,
    onExitToRoot: exitToRoot,
    onCut: (id) => setClipboard({ operation: CLIPBOARD_OP.CUT, nodeId: id }),
    onCopy: (id) => setClipboard({ operation: CLIPBOARD_OP.COPY, nodeId: id }),
    onPaste,
    findNodeById,
  });

  const subtreeParent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const toastPosition = pendingToast !== null ? positions.get(pendingToast.nodeId) : undefined;
  const targetPos = dragTargetId !== null ? positions.get(dragTargetId) : undefined;

  if (isLoading) return <div className={styles.centered}>Loading…</div>;
  if (error !== null) return <div className={styles.centered}>Error: {error}</div>;

  return (
    <div className={styles.container}>
      <MindmapCanvas
        root={displayRoot}
        collapsedNodeIds={effectiveCollapsedIds}
        selectedNodeId={selectedNodeId}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        dragSourceId={dragSourceId}
        hasClipboard={clipboard !== null}
        canvasOverlay={placeholderPos !== null && targetPos !== undefined ? (
          <DragPlaceholder placeholderPos={placeholderPos} targetPos={targetPos} subtreeLayout={subtreeLayout} collapsedNodeIds={collapsedNodeIds} dragSourceId={dragSourceId} tree={tree} />
        ) : undefined}
        onSelect={selectNode}
        onDoubleClick={onDoubleClick}
        onCommitEdit={onCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={handleContextAction}
        onDragStart={onDragStart}
        onCanvasClick={() => selectNode(null)}
        onStatusClick={onStatusClick}
      />

      {subtreeRootId !== null && <SubtreeNavPill parentTitle={subtreeParent?.title ?? "Arlesh"} onBack={exitSubtree} />}

      {pendingToast !== null && toastPosition !== undefined && (
        <StatusToast message={pendingToast.message} position={toastPosition} onDismiss={clearToast} />
      )}

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal node={editorModal.node} allTags={allTags} availableForDep={availableForDep} onSave={onTaskSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "goal" && (
        <GoalEditorModal node={editorModal.node} allTags={allTags} onSave={onGoalSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "domain" && (
        <TitleEditorModal heading="Edit Domain" title={editorModal.node.title} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "project" && (
        <ProjectEditorModal node={editorModal.node} onSave={onProjectSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "tag" && (
        <TitleEditorModal heading="Edit Tag" title={editorModal.node.title} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}

      {warningModal !== null && retypeActions !== null && (
        <WarningConfirmModal
          heading={warningModal.heading}
          consequences={warningModal.consequences}
          actions={retypeActions}
          onCancel={() => setWarningModal(null)}
        />
      )}

      {dragSourceId !== null && ghostPos !== null && (() => {
        const sourceNode = findNode(tree, dragSourceId);
        if (sourceNode === undefined) return null;
        const depth = positions.get(dragSourceId)?.depth ?? 0;
        return <DragGhost node={sourceNode} depth={depth} x={ghostPos.x} y={ghostPos.y} />;
      })()}
    </div>
  );
}
