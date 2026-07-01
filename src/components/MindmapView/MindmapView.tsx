import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "./use-mindmap-data";
import { useDrag } from "./use-drag";
import { useCanvasLayout } from "./use-canvas-layout";
import { useNodeTypeManager } from "./use-node-type-manager";
import { useNodeEditor } from "./use-node-editor";
import { useNodeActions } from "./use-node-actions";
import { useContextAction } from "./use-context-action";
import { useNavigateArrow } from "./use-navigate-arrow";
import { useKeyboardMindmap } from "./use-keyboard-mindmap";
import { useMindmapStore, CLIPBOARD_OP } from "@/stores/use-mindmap-store";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { updateTask, reparentScopeConflicts } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { findNode, findParent, collectTasksAndGoals, collectSubtreePostOrder, computeShiftSelectRange } from "@/utils/mindmap-tree";
import MindmapCanvas, { type MindmapCanvasHandle } from "@/components/MindmapCanvas/MindmapCanvas";
import DragGhost from "@/components/DragGhost/DragGhost";
import DragPlaceholder from "@/components/DragPlaceholder/DragPlaceholder";
import SubtreeNavPill from "@/components/SubtreeNavPill/SubtreeNavPill";
import StatusToast from "@/components/StatusToast/StatusToast";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import styles from "./MindmapView.module.css";

export default function MindmapView() {
  const { t } = useTranslation(["common", "editor", "warnings", "nodeKinds"]);
  const { tree, isLoading, error, createNode, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, reload } =
    useMindmapData();
  const {
    selectedNodeId, selectedNodeIds, subtreeRootId, clipboard, collapsedNodeIds, pendingToast,
    selectNode, addToSelection, setSelection, enterSubtree, exitSubtree, exitToRoot,
    setClipboard, toggleCollapsed, showToast, clearToast,
  } = useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const canvasRef = useRef<MindmapCanvasHandle>(null);

  useEffect(() => {
    if (subtreeRootId !== null) canvasRef.current?.centerOnRoot();
  }, [subtreeRootId]);

  const {
    editorModal, setEditorModal, allTags, availableForDep, onDoubleClick,
    onTaskSave, onGoalSave, onSimpleSave, onProjectSave,
    checkScopeClamp, confirmScopeClamp, scopeClampRequest, resolveScopeClamp,
  } = useNodeEditor({ tree, allTasksAndGoals, renameNode, reload });

  // Wraps moveNode so a drag reparent that would orphan scoped items prompts to clamp them first.
  const guardedMoveNode = useCallback(
    async (id: string, kind: NodeKind, parentId: string, parentKind: NodeKind, position: number) => {
      if (kind === "task" || kind === "goal") {
        const nodeDbId = parseInt(id.split("-").pop() ?? "0", 10);
        const parentDbId = parseInt(parentId.split("-").pop() ?? "0", 10);
        const { ancestor_time_scope, conflicts } = await reparentScopeConflicts(kind, nodeDbId, parentKind, parentDbId);
        if (ancestor_time_scope !== null && conflicts.length > 0) {
          if (!(await confirmScopeClamp(conflicts))) return;
          for (const conflict of conflicts) {
            if (conflict.node_type === "goal") {
              await updateGoal(conflict.node_id, { time_scope: ancestor_time_scope });
            } else {
              await updateTask(conflict.node_id, { time_scope: ancestor_time_scope });
            }
          }
        }
      }
      await moveNode(id, kind, parentId, parentKind, position);
    },
    [confirmScopeClamp, moveNode],
  );

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag({ tree, moveNode: guardedMoveNode });

  const { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos } = useCanvasLayout({
    displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId,
  });

  const { warningModal, setWarningModal, cycleType, retypeActions } = useNodeTypeManager({
    tree, retypeNode, selectNode, showToast,
  });

  const handleConfirmDelete = useCallback(() => {
    if (deleteTargets === null) return;

    // Collect post-order subtrees for all targets, deduplicating via Set
    const deletedIds = new Set(deleteTargets);
    const seen = new Set<string>();
    const nodesToDelete: Array<{ id: string; kind: import("@/utils/tree-layout").NodeKind }> = [];
    for (const targetId of deleteTargets) {
      const node = findNode(tree, targetId);
      if (node === undefined) continue;
      for (const entry of collectSubtreePostOrder(node)) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          nodesToDelete.push(entry);
        }
      }
    }
    if (nodesToDelete.length === 0) { setDeleteTargets(null); return; }

    // Compute focus target: nearest ancestor of the first target that won't be deleted.
    let focusId: string | null = null;
    const firstId = deleteTargets[0];
    if (firstId !== undefined) {
      let ancestor = findParent(tree, firstId);
      while (ancestor !== null) {
        if (!deletedIds.has(ancestor.id) && ancestor.id !== "root") {
          focusId = ancestor.id;
          break;
        }
        ancestor = findParent(tree, ancestor.id);
      }
    }

    setIsDeleting(true);
    setDeleteError(null);
    void removeNode(nodesToDelete)
      .then(() => { setDeleteTargets(null); selectNode(focusId); })
      .catch((err: unknown) => { setDeleteError(err instanceof Error ? err.message : String(err)); })
      .finally(() => setIsDeleting(false));
  }, [deleteTargets, tree, removeNode, selectNode]);

  const subtreeParent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const subtreeParentId = subtreeParent !== null && subtreeParent.id !== "root" ? subtreeParent.id : null;
  const handleExitSubtree = useCallback(() => exitSubtree(subtreeParentId), [exitSubtree, subtreeParentId]);

  const { onStatusClick, onCommitEdit, onCreateChild, onCreateSibling, onInsertParent, onDelete, onPaste } = useNodeActions({
    tree, clipboard, moveNode, onRequestDelete: setDeleteTargets, reload, renameNode,
    createNode, createChild, selectNode, setClipboard, setEditingNodeId,
  });

  const { navigateArrow } = useNavigateArrow({ selectedNodeId, positions, tree, selectNode });

  const { onContextAction } = useContextAction({
    findNodeById, enterSubtree, setEditingNodeId, cycleType,
    setClipboard, clipboard, onPaste, toggleCollapsed, onDelete,
  });

  const handleCtrlClick = useCallback((id: string) => { addToSelection(id); }, [addToSelection]);

  const handleShiftClick = useCallback((id: string) => {
    if (selectedNodeId === null) { selectNode(id); return; }
    const range = computeShiftSelectRange(tree, selectedNodeId, id);
    if (range !== null) {
      setSelection(new Set(range), selectedNodeId);
    }
  }, [selectedNodeId, tree, selectNode, setSelection]);

  useKeyboardMindmap({
    isInputActive: editingNodeId !== null || editorModal !== null || deleteTargets !== null,
    isWarningActive: warningModal !== null,
    onDismissWarning: () => setWarningModal(null),
    selectedNodeId,
    selectedNodeIds,
    subtreeRootId,
    clipboard,
    onNavigate: navigateArrow,
    onCycleType: cycleType,
    onReorder: (id, dir) => { void reorderNode(id, dir); },
    onStartRename: setEditingNodeId,
    onCreateChild,
    onCreateSibling,
    onInsertParent,
    onOpenEditor: onDoubleClick,
    onDelete,
    onToggleCollapsed: toggleCollapsed,
    onCycleStatus: onStatusClick,
    onDeselect: () => { selectNode(null); },
    onExitSubtree: handleExitSubtree,
    onExitToRoot: exitToRoot,
    onCut: (ids) => setClipboard({ operation: CLIPBOARD_OP.CUT, nodeIds: ids }),
    onCopy: (ids) => setClipboard({ operation: CLIPBOARD_OP.COPY, nodeIds: ids }),
    onPaste,
    onEnterSubtree: enterSubtree,
    findNodeById,
  });
  const toastPosition = pendingToast !== null ? positions.get(pendingToast.nodeId) : undefined;
  const targetPos = dragTargetId !== null ? positions.get(dragTargetId) : undefined;

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
      <MindmapCanvas
        ref={canvasRef}
        root={displayRoot}
        collapsedNodeIds={effectiveCollapsedIds}
        selectedNodeIds={selectedNodeIds}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        dragSourceId={dragSourceId}
        hasClipboard={clipboard !== null}
        canvasOverlay={placeholderPos !== null && targetPos !== undefined ? (
          <DragPlaceholder placeholderPos={placeholderPos} targetPos={targetPos} subtreeLayout={subtreeLayout} collapsedNodeIds={collapsedNodeIds} dragSourceId={dragSourceId} tree={tree} />
        ) : undefined}
        onSelect={selectNode}
        onCtrlClick={handleCtrlClick}
        onShiftClick={handleShiftClick}
        onDoubleClick={onDoubleClick}
        onCommitEdit={onCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={onContextAction}
        onDragStart={onDragStart}
        onCanvasClick={() => selectNode(null)}
        onStatusClick={onStatusClick}
      />

      {subtreeRootId !== null && (
        <SubtreeNavPill
          rootTitle={tree.title}
          parentTitle={subtreeParent?.title ?? tree.title}
          onBack={handleExitSubtree}
          {...(subtreeParentId !== null ? { onBackToRoot: exitToRoot } : {})}
        />
      )}

      {pendingToast !== null && toastPosition !== undefined && (
        <StatusToast message={pendingToast.message} position={toastPosition} onDismiss={clearToast} />
      )}

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal node={editorModal.node} allTags={allTags} availableForDep={availableForDep} onSave={onTaskSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "goal" && (
        <GoalEditorModal node={editorModal.node} allTags={allTags} onSave={onGoalSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "domain" && (
        <TitleEditorModal heading={t("editor:editDomain")} title={editorModal.node.title} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "project" && (
        <ProjectEditorModal node={editorModal.node} onSave={onProjectSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "tag" && (
        <TitleEditorModal heading={t("editor:editTag")} title={editorModal.node.title} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}

      {warningModal !== null && retypeActions !== null && (
        <WarningConfirmModal
          heading={warningModal.heading}
          consequences={warningModal.consequences}
          actions={retypeActions}
          onCancel={() => setWarningModal(null)}
        />
      )}

      {scopeClampRequest !== null && (
        <WarningConfirmModal
          heading={t("warnings:scopeClampHeading", { count: scopeClampRequest.conflicts.length })}
          consequences={scopeClampRequest.conflicts.map((c) =>
            t("warnings:scopeClampItem", {
              type: c.node_type === "goal" ? t("nodeKinds:goal") : t("nodeKinds:task"),
              id: c.node_id,
            }),
          )}
          actions={[{ label: t("warnings:scopeClampAction"), variant: "primary", onClick: () => resolveScopeClamp(true) }]}
          onCancel={() => resolveScopeClamp(false)}
        />
      )}

      {deleteTargets !== null && (() => {
        const firstId = deleteTargets[0];
        const firstNode = firstId !== undefined ? findNode(tree, firstId) : undefined;
        if (firstNode === undefined) return null;
        // Count total descendants across all targets (deduplicated)
        const seen = new Set<string>(deleteTargets);
        let descendantCount = 0;
        for (const id of deleteTargets) {
          const n = findNode(tree, id);
          if (n === undefined) continue;
          for (const entry of collectSubtreePostOrder(n)) {
            if (!seen.has(entry.id)) { seen.add(entry.id); descendantCount++; }
          }
        }
        return (
          <DeleteConfirmModal
            nodeTitle={firstNode.title}
            nodeCount={deleteTargets.length}
            descendantCount={descendantCount}
            isDeleting={isDeleting}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={() => { setDeleteTargets(null); setDeleteError(null); }}
          />
        );
      })()}

      {dragSourceId !== null && ghostPos !== null && (() => {
        const sourceNode = findNode(tree, dragSourceId);
        if (sourceNode === undefined) return null;
        const depth = positions.get(dragSourceId)?.depth ?? 0;
        return <DragGhost node={sourceNode} depth={depth} x={ghostPos.x} y={ghostPos.y} />;
      })()}
    </div>
  );
}
