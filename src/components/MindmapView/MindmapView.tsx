import { useCallback, useEffect, useMemo, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import type { RetypeOptions } from "@/hooks/use-mindmap-data";
import { useDrag } from "@/hooks/use-drag";
import { useKeyboardMindmap } from "@/hooks/use-keyboard-mindmap";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { computeLayout, computeSubtreeLayout, HORIZONTAL_GAP, VERTICAL_GAP } from "@/utils/tree-layout";
import type { MindmapNode, NodeKind, Position } from "@/utils/tree-layout";
import { validTypesForCycling, crossesGoalTaskBoundary } from "@/utils/node-meta";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "@/utils/status-mapping";
import { findNode, findParent, nearestInDirection, collectTasksAndGoals } from "@/utils/mindmap-tree";
import { addTagToTask, removeTagFromTask, updateTask, addTaskDependency, removeTaskDependency } from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal, updateGoal } from "@/api/goals";
import { listDomains, updateDomain } from "@/api/domains";
import type { Domain } from "@/api/domains";
import MindmapCanvas from "@/components/MindmapCanvas/MindmapCanvas";
import DragGhost from "@/components/DragGhost/DragGhost";
import DragPlaceholder from "@/components/DragPlaceholder/DragPlaceholder";
import SubtreeNavPill from "@/components/SubtreeNavPill/SubtreeNavPill";
import StatusToast from "@/components/StatusToast/StatusToast";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import type { WarningAction } from "@/components/WarningConfirmModal/WarningConfirmModal";
import type { ContextMenuAction } from "@/components/NodeContextMenu/NodeContextMenu";
import styles from "./MindmapView.module.css";

function nextTaskStatus(current: string): "todo" | "in_progress" | "done" {
  if (current === "in_progress") return "done";
  if (current === "done") return "todo";
  return "in_progress";
}

function buildRetypeActions(hasGoalChildren: boolean, toKind: NodeKind, confirm: (options?: RetypeOptions) => void): WarningAction[] {
  if (hasGoalChildren) {
    return [
      { label: "Re-parent sub-goals", variant: "primary", onClick: () => { confirm({ goalChildrenAction: "reparent" }); } },
      { label: "Delete sub-goals", variant: "danger", onClick: () => { confirm({ goalChildrenAction: "remove" }); } },
    ];
  }
  return [{ label: `Convert to ${toKind}`, variant: "primary", onClick: () => { confirm(); } }];
}

export default function MindmapView() {
  const { tree, isLoading, error, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, reload } = useMindmapData();
  const { selectedNodeId, subtreeRootId, clipboard, collapsedNodeIds, pendingToast, selectNode, enterSubtree, exitSubtree, exitToRoot, setClipboard, toggleCollapsed, showToast, clearToast } = useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editorModal, setEditorModal] = useState<{ nodeId: string; node: MindmapNode } | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);
  const [warningModal, setWarningModal] = useState<{ nodeId: string; fromKind: NodeKind; toKind: NodeKind; heading: string; consequences: string[]; hasGoalChildren: boolean } | null>(null);

  useEffect(() => { void listDomains("tag").then(setAllTags); }, []);

  const findNodeById = useCallback((id: string): MindmapNode | undefined => findNode(tree, id), [tree]);
  const allTasksAndGoals = useMemo(() => { const acc: MindmapNode[] = []; collectTasksAndGoals(tree, acc); return acc; }, [tree]);

  const handleDrop = useCallback(
    (nodeId: string, targetId: string) => {
      const source = findNode(tree, nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined) return;
      const siblingPositions = target.children.filter((c) => c.id !== nodeId).map((c) => c.position);
      const lastPosition = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      void moveNode(nodeId, source.kind, targetId, target.kind, lastPosition);
    },
    [tree, moveNode],
  );

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag(tree, handleDrop);

  const displayRoot = useMemo<MindmapNode>(() => (subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree), [subtreeRootId, tree]);

  const effectiveCollapsedIds = useMemo<ReadonlySet<string>>(() => {
    if (dragSourceId === null) return collapsedNodeIds;
    const s = new Set(collapsedNodeIds);
    s.add(dragSourceId);
    return s;
  }, [collapsedNodeIds, dragSourceId]);

  const positions = useMemo(() => computeLayout(displayRoot, effectiveCollapsedIds), [displayRoot, effectiveCollapsedIds]);

  const subtreeLayout = useMemo(() => {
    if (dragSourceId === null || dragTargetId === null) return null;
    const sourceNode = findNode(tree, dragSourceId);
    if (sourceNode === undefined || sourceNode.children.length === 0) return null;
    const targetPos = positions.get(dragTargetId);
    const direction: 1 | -1 = (targetPos?.x ?? 0) >= 0 ? 1 : -1;
    return computeSubtreeLayout(sourceNode, collapsedNodeIds, direction);
  }, [dragSourceId, dragTargetId, tree, collapsedNodeIds, positions]);

  const placeholderPos = useMemo<Position | null>(() => {
    if (dragTargetId === null || dragSourceId === null) return null;
    const targetPos = positions.get(dragTargetId);
    if (targetPos === undefined) return null;
    const direction: 1 | -1 = targetPos.x >= 0 ? 1 : -1;
    const childX = targetPos.x + direction * HORIZONTAL_GAP;
    const childDepth = targetPos.depth + 1;
    const targetNode = findNode(tree, dragTargetId);
    if (targetNode === undefined) return { x: childX, y: targetPos.y, depth: childDepth };
    const visibleChildren = targetNode.children.filter((c) => !collapsedNodeIds.has(c.id) && c.id !== dragSourceId);
    if (visibleChildren.length === 0) return { x: childX, y: targetPos.y, depth: childDepth };
    const yValues = visibleChildren.map((c) => positions.get(c.id)?.y).filter((v): v is number => v !== undefined);
    const bottomY = yValues.length > 0 ? Math.max(...yValues) : targetPos.y;
    let topSpread = 0;
    if (subtreeLayout !== null) {
      for (const p of subtreeLayout.values()) { if (p.y < 0) topSpread = Math.max(topSpread, -p.y); }
    }
    return { x: childX, y: bottomY + VERTICAL_GAP + topSpread, depth: childDepth };
  }, [dragTargetId, dragSourceId, positions, collapsedNodeIds, subtreeLayout, tree]);

  const navigateArrow = useCallback(
    (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => {
      if (selectedNodeId === null) return;
      const target = nearestInDirection(selectedNodeId, positions, key);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, selectNode],
  );

  const confirmRetype = useCallback(
    (options?: RetypeOptions) => {
      if (warningModal === null) return;
      const { nodeId, fromKind, toKind } = warningModal;
      setWarningModal(null);
      void retypeNode(nodeId, fromKind, toKind, options).then((newId) => { selectNode(newId ?? nodeId); });
    },
    [warningModal, retypeNode, selectNode],
  );

  const cycleType = useCallback(
    (nodeId: string, direction: 1 | -1) => {
      const node = findNodeById(nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const parent = findParent(tree, nodeId);
      const validTypes = validTypesForCycling(node.kind, parent?.kind ?? null);
      if (validTypes.length <= 1) return;
      const currentIdx = validTypes.indexOf(node.kind);
      if (currentIdx === -1) return;
      const newKind = validTypes[(currentIdx + direction + validTypes.length) % validTypes.length];
      if (newKind === undefined || newKind === node.kind) return;
      if (crossesGoalTaskBoundary(node.kind, newKind)) {
        const newStatus = node.kind === "goal" ? goalStatusToTaskStatus(node.status ?? "active") : taskStatusToGoalStatus(node.status ?? "todo");
        showToast({ nodeId, message: `Status: ${node.status ?? "—"} → ${newStatus}` });
        const hasGoalChildren = node.kind === "goal" && node.children.some((c) => c.kind === "goal");
        const hasBlockedReason = node.blockedReason != null && node.blockedReason !== "";
        if (hasGoalChildren || hasBlockedReason) {
          const consequences: string[] = [];
          if (hasBlockedReason) {
            const reason = node.blockedReason ?? "";
            const preview = reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
            consequences.push(`Block reason will carry over: "${preview}"`);
          }
          if (hasGoalChildren) {
            const count = node.children.filter((c) => c.kind === "goal").length;
            consequences.push(`${count} sub-goal${count > 1 ? "s" : ""} cannot live under a task — choose what happens to them`);
          }
          setWarningModal({ nodeId, fromKind: node.kind, toKind: newKind, heading: `Convert to ${newKind}?`, consequences, hasGoalChildren });
          return;
        }
      }
      void retypeNode(nodeId, node.kind, newKind).then((newId) => { selectNode(newId ?? nodeId); });
    },
    [findNodeById, tree, showToast, retypeNode, selectNode],
  );

  const pasteClipboard = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const sourceNode = findNodeById(clipboard.nodeId);
      const targetNode = findNodeById(targetId);
      if (sourceNode === undefined || targetNode === undefined) return;
      const pasteSiblingPositions = targetNode.children.filter((c) => c.id !== clipboard.nodeId).map((c) => c.position);
      const pastePosition = pasteSiblingPositions.length > 0 ? Math.max(...pasteSiblingPositions) + 1 : 0;
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
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? "todo") }).then(() => reload()).catch((err: unknown) => console.error("[arlesh] status cycle failed:", err));
    },
    [findNodeById, reload],
  );

  const handleCreateChild = useCallback(
    (nodeId: string) => {
      const node = findNodeById(nodeId);
      if (node === undefined || !node.id.includes("-") || node.kind === "tag") return;
      void (async () => {
        try {
          const newNode = await createChild(nodeId, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error("[arlesh] Tab createChild failed:", err);
        }
      })();
    },
    [findNodeById, createChild, selectNode],
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      const node = findNodeById(nodeId);
      if (node !== undefined && node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
        void removeNode(nodeId, node.kind).then(() => selectNode(null));
      }
    },
    [findNodeById, removeNode, selectNode],
  );

  const handleCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") { setEditingNodeId(null); return; }
      const node = findNodeById(nodeId);
      if (node !== undefined) void renameNode(nodeId, node.kind, title.trim()).then(() => setEditingNodeId(null));
    },
    [findNodeById, renameNode],
  );

  const handleCut = useCallback((id: string) => setClipboard({ operation: "cut", nodeId: id }), [setClipboard]);
  const handleCopy = useCallback((id: string) => setClipboard({ operation: "copy", nodeId: id }), [setClipboard]);
  const handleDismissWarning = useCallback(() => setWarningModal(null), []);
  const handleStartRename = useCallback((id: string) => setEditingNodeId(id), []);
  const handleReorder = useCallback((id: string, dir: 1 | -1) => { void reorderNode(id, dir); }, [reorderNode]);

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
        case "collapse":
        case "expand": toggleCollapsed(nodeId); break;
        case "delete":
          if (node.kind !== "aspect" && confirm(`Delete "${node.title}"?`)) {
            void removeNode(nodeId, node.kind).then(() => selectNode(null));
          }
          break;
      }
    },
    [findNodeById, enterSubtree, cycleType, setClipboard, clipboard, pasteClipboard, toggleCollapsed, removeNode, selectNode],
  );

  const handleDoubleClick = useCallback(
    (nodeId: string) => {
      const node = findNodeById(nodeId);
      if (node === undefined || node.kind === "aspect") return;
      setEditorModal({ nodeId, node });
    },
    [findNodeById],
  );

  const handleTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateTask(dbId, { title: data.title, status: data.status, blocked_reason: data.blockedReason });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToTask(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromTask(dbId, tagId);
      for (const dep of data.addedDeps) await addTaskDependency(dbId, dep);
      for (const dep of data.removedDeps) await removeTaskDependency(dbId, dep);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const handleGoalSave = useCallback(
    async (data: GoalSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateGoal(dbId, { title: data.title, status: data.status, blocked_reason: data.blockedReason });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToGoal(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromGoal(dbId, tagId);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const handleSimpleSave = useCallback(
    async (title: string) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      await renameNode(nodeId, node.kind, title);
      setEditorModal(null);
    },
    [editorModal, renameNode],
  );

  const handleProjectSave = useCallback(
    async (data: ProjectSaveData) => {
      if (editorModal === null) return;
      const { nodeId } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateDomain(dbId, {
        title: data.title,
        ...(data.status !== "" ? { status: data.status } : {}),
        ...(data.knowledgeBaseDirectory !== "" ? { knowledge_base_directory: data.knowledgeBaseDirectory } : {}),
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  useKeyboardMindmap({
    isInputActive: editingNodeId !== null || editorModal !== null,
    warningModal,
    onDismissWarning: handleDismissWarning,
    selectedNodeId,
    subtreeRootId,
    clipboard,
    onNavigate: navigateArrow,
    onCycleType: cycleType,
    onReorder: handleReorder,
    onStartRename: handleStartRename,
    onCreateChild: handleCreateChild,
    onDelete: handleDelete,
    onToggleCollapsed: toggleCollapsed,
    onExitSubtree: exitSubtree,
    onExitToRoot: exitToRoot,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: pasteClipboard,
    findNodeById,
  });

  const subtreeParent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const toastPosition = pendingToast !== null ? positions.get(pendingToast.nodeId) : undefined;
  const availableForDep = editorModal !== null ? allTasksAndGoals.filter((n) => n.id !== editorModal.nodeId) : [];
  const canvasPlaceholderTargetPos = dragTargetId !== null ? positions.get(dragTargetId) : undefined;

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
        canvasOverlay={placeholderPos !== null && canvasPlaceholderTargetPos !== undefined ? (
          <DragPlaceholder placeholderPos={placeholderPos} targetPos={canvasPlaceholderTargetPos} subtreeLayout={subtreeLayout} collapsedNodeIds={collapsedNodeIds} dragSourceId={dragSourceId} tree={tree} />
        ) : undefined}
        onSelect={selectNode}
        onDoubleClick={handleDoubleClick}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={handleContextAction}
        onDragStart={onDragStart}
        onCanvasClick={() => selectNode(null)}
        onStatusClick={handleStatusClick}
      />

      {subtreeRootId !== null && <SubtreeNavPill parentTitle={subtreeParent?.title ?? "Arlesh"} onBack={exitSubtree} />}

      {pendingToast !== null && toastPosition !== undefined && <StatusToast message={pendingToast.message} position={toastPosition} onDismiss={clearToast} />}

      {editorModal !== null && editorModal.node.kind === "task" && <TaskEditorModal node={editorModal.node} allTags={allTags} availableForDep={availableForDep} onSave={handleTaskSave} onClose={() => setEditorModal(null)} />}
      {editorModal !== null && editorModal.node.kind === "goal" && <GoalEditorModal node={editorModal.node} allTags={allTags} onSave={handleGoalSave} onClose={() => setEditorModal(null)} />}
      {editorModal !== null && editorModal.node.kind === "domain" && <TitleEditorModal heading="Edit Domain" title={editorModal.node.title} onSave={handleSimpleSave} onClose={() => setEditorModal(null)} />}
      {editorModal !== null && editorModal.node.kind === "project" && <ProjectEditorModal node={editorModal.node} onSave={handleProjectSave} onClose={() => setEditorModal(null)} />}
      {editorModal !== null && editorModal.node.kind === "tag" && <TitleEditorModal heading="Edit Tag" title={editorModal.node.title} onSave={handleSimpleSave} onClose={() => setEditorModal(null)} />}

      {warningModal !== null && <WarningConfirmModal heading={warningModal.heading} consequences={warningModal.consequences} actions={buildRetypeActions(warningModal.hasGoalChildren, warningModal.toKind, confirmRetype)} onCancel={() => setWarningModal(null)} />}

      {dragSourceId !== null && ghostPos !== null && (() => {
        const sourceNode = findNode(tree, dragSourceId);
        if (sourceNode === undefined) return null;
        const depth = positions.get(dragSourceId)?.depth ?? 0;
        return <DragGhost node={sourceNode} depth={depth} x={ghostPos.x} y={ghostPos.y} />;
      })()}
    </div>
  );
}
