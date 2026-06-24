import { useCallback, useMemo, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useDrag } from "@/hooks/use-drag";
import { useCanvasLayout } from "@/hooks/use-canvas-layout";
import { useNodeTypeManager } from "@/hooks/use-node-type-manager";
import type { WarningModalState } from "@/hooks/use-node-type-manager";
import { useNodeEditor } from "@/hooks/use-node-editor";
import { useKeyboardMindmap } from "@/hooks/use-keyboard-mindmap";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode, findParent, nearestInDirection, collectTasksAndGoals } from "@/utils/mindmap-tree";
import { isValidDropTarget } from "@/utils/node-meta";
import { updateTask } from "@/api/tasks";
import type { ContextMenuAction } from "@/components/NodeContextMenu/NodeContextMenu";
import type { WarningAction } from "@/components/WarningConfirmModal/WarningConfirmModal";
import type { RetypeOptions } from "@/hooks/use-mindmap-data";
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

function nextTaskStatus(current: string): "todo" | "in_progress" | "done" {
  if (current === "in_progress") return "done";
  if (current === "done") return "todo";
  return "in_progress";
}

function buildRetypeActions(
  hasGoalChildren: boolean,
  toKind: NodeKind,
  confirm: (options?: RetypeOptions) => void,
): WarningAction[] {
  if (hasGoalChildren) {
    return [
      { label: "Re-parent sub-goals", variant: "primary", onClick: () => { confirm({ goalChildrenAction: "reparent" }); } },
      { label: "Delete sub-goals", variant: "danger", onClick: () => { confirm({ goalChildrenAction: "remove" }); } },
    ];
  }
  return [{ label: `Convert to ${toKind}`, variant: "primary", onClick: () => { confirm(); } }];
}

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
      if (source === undefined || target === undefined) return;
      if (!isValidDropTarget(source.kind, target.kind)) return;
      const siblingPositions = target.children.filter((c) => c.id !== nodeId).map((c) => c.position);
      const lastPosition = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      void moveNode(nodeId, source.kind, targetId, target.kind, lastPosition);
    },
    [tree, moveNode],
  );

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag(tree, handleDrop);

  const { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos } = useCanvasLayout({
    displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId,
  });

  const { warningModal, setWarningModal, confirmRetype, cycleType } = useNodeTypeManager({
    tree, retypeNode, selectNode, showToast,
  });

  const { editorModal, setEditorModal, allTags, availableForDep, onDoubleClick, onTaskSave, onGoalSave, onSimpleSave, onProjectSave } =
    useNodeEditor({ tree, allTasksAndGoals, renameNode, reload });

  const navigateArrow = useCallback(
    (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => {
      if (selectedNodeId === null) return;
      const target = nearestInDirection(selectedNodeId, positions, key);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, selectNode],
  );

  const pasteClipboard = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const sourceNode = findNodeById(clipboard.nodeId);
      const targetNode = findNodeById(targetId);
      if (sourceNode === undefined || targetNode === undefined) return;
      const siblingPositions = targetNode.children
        .filter((c) => c.id !== clipboard.nodeId)
        .map((c) => c.position);
      const pastePosition = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      void moveNode(clipboard.nodeId, sourceNode.kind, targetId, targetNode.kind, pastePosition).then(() => {
        if (clipboard.operation === "cut") setClipboard(null);
      });
    },
    [clipboard, findNodeById, moveNode, setClipboard],
  );

  const handleStatusClick = useCallback(
    (nodeId: string) => {
      const node = findNodeById(nodeId);
      if (node === undefined || node.kind !== "task") return;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? "todo") })
        .then(() => reload())
        .catch((err: unknown) => console.error("[arlesh] status cycle failed:", err));
    },
    [findNodeById, reload],
  );

  const handleCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") { setEditingNodeId(null); return; }
      const node = findNodeById(nodeId);
      if (node !== undefined) void renameNode(nodeId, node.kind, title.trim()).then(() => setEditingNodeId(null));
    },
    [findNodeById, renameNode],
  );

  const handleContextAction = useCallback(
    (nodeId: string, action: ContextMenuAction) => {
      const node = findNodeById(nodeId);
      if (node === undefined) return;
      switch (action) {
        case "enter": enterSubtree(nodeId); break;
        case "rename": setEditingNodeId(nodeId); break;
        case "type-up": cycleType(nodeId, 1); break;
        case "type-down": cycleType(nodeId, -1); break;
        case "cut": setClipboard({ operation: "cut", nodeId }); break;
        case "copy": setClipboard({ operation: "copy", nodeId }); break;
        case "paste": if (clipboard !== null) pasteClipboard(nodeId); break;
        case "collapse": case "expand": toggleCollapsed(nodeId); break;
        case "delete":
          if (node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
            void removeNode(nodeId, node.kind).then(() => selectNode(null));
          }
          break;
      }
    },
    [findNodeById, enterSubtree, cycleType, setClipboard, clipboard, pasteClipboard, toggleCollapsed, removeNode, selectNode],
  );

  useKeyboardMindmap({
    isInputActive: editingNodeId !== null || editorModal !== null,
    warningModal: warningModal as WarningModalState | null,
    onDismissWarning: () => setWarningModal(null),
    selectedNodeId,
    subtreeRootId,
    clipboard,
    onNavigate: navigateArrow,
    onCycleType: cycleType,
    onReorder: (id, dir) => { void reorderNode(id, dir); },
    onStartRename: (id) => setEditingNodeId(id),
    onCreateChild: (id) => {
      const node = findNodeById(id);
      if (node === undefined || !id.includes("-") || node.kind === "tag") return;
      void (async () => {
        try {
          const newNode = await createChild(id, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error("[arlesh] createChild failed:", err);
        }
      })();
    },
    onDelete: (id) => {
      const node = findNodeById(id);
      if (node !== undefined && node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
        void removeNode(id, node.kind).then(() => selectNode(null));
      }
    },
    onToggleCollapsed: toggleCollapsed,
    onExitSubtree: exitSubtree,
    onExitToRoot: exitToRoot,
    onCut: (id) => setClipboard({ operation: "cut", nodeId: id }),
    onCopy: (id) => setClipboard({ operation: "copy", nodeId: id }),
    onPaste: pasteClipboard,
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
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={handleContextAction}
        onDragStart={onDragStart}
        onCanvasClick={() => selectNode(null)}
        onStatusClick={handleStatusClick}
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

      {warningModal !== null && (
        <WarningConfirmModal
          heading={warningModal.heading}
          consequences={warningModal.consequences}
          actions={buildRetypeActions(warningModal.hasGoalChildren, warningModal.toKind, confirmRetype)}
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
