import { useCallback, useMemo, useState } from "react";
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
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode, findParent, collectTasksAndGoals, collectSubtreePostOrder } from "@/utils/mindmap-tree";
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
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import styles from "./MindmapView.module.css";

export default function MindmapView() {
  const { t } = useTranslation(["common", "editor"]);
  const { tree, isLoading, error, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, reload } =
    useMindmapData();
  const { selectedNodeId, subtreeRootId, clipboard, collapsedNodeIds, pendingToast, selectNode, enterSubtree, exitSubtree, exitToRoot, setClipboard, toggleCollapsed, showToast, clearToast } =
    useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
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

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag({ tree, moveNode });

  const { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos } = useCanvasLayout({
    displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId,
  });

  const { warningModal, setWarningModal, cycleType, retypeActions } = useNodeTypeManager({
    tree, retypeNode, selectNode, showToast,
  });

  const { editorModal, setEditorModal, allTags, availableForDep, onDoubleClick, onTaskSave, onGoalSave, onSimpleSave, onProjectSave } =
    useNodeEditor({ tree, allTasksAndGoals, renameNode, reload });

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget === null) return;
    const node = findNode(tree, deleteTarget);
    if (node === undefined) { setDeleteTarget(null); return; }
    const nodesToDelete = collectSubtreePostOrder(node);
    const parentNode = findParent(tree, deleteTarget);
    const parentId = parentNode !== null && parentNode.id !== "root" ? parentNode.id : null;
    setIsDeleting(true);
    setDeleteError(null);
    void removeNode(nodesToDelete)
      .then(() => { setDeleteTarget(null); selectNode(parentId); })
      .catch((err: unknown) => { setDeleteError(err instanceof Error ? err.message : String(err)); })
      .finally(() => setIsDeleting(false));
  }, [deleteTarget, tree, removeNode, selectNode]);

  const { onStatusClick, onCommitEdit, onCreateChild, onDelete, onPaste } = useNodeActions({
    tree, clipboard, moveNode, onRequestDelete: setDeleteTarget, reload, renameNode,
    createChild, selectNode, setClipboard, setEditingNodeId,
  });

  const { navigateArrow } = useNavigateArrow({ selectedNodeId, positions, tree, selectNode });

  const { onContextAction } = useContextAction({
    findNodeById, enterSubtree, setEditingNodeId, cycleType,
    setClipboard, clipboard, onPaste, toggleCollapsed, onDelete,
  });

  useKeyboardMindmap({
    isInputActive: editingNodeId !== null || editorModal !== null || deleteTarget !== null,
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

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

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
        onContextAction={onContextAction}
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

      {deleteTarget !== null && (() => {
        const node = findNode(tree, deleteTarget);
        if (node === undefined) return null;
        const descendantCount = collectSubtreePostOrder(node).length - 1;
        return (
          <DeleteConfirmModal
            nodeTitle={node.title}
            descendantCount={descendantCount}
            isDeleting={isDeleting}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
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
