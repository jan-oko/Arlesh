import { useCallback, useEffect, useMemo, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import type { RetypeOptions } from "@/hooks/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { computeLayout } from "@/utils/tree-layout";
import { validTypesForCycling, crossesGoalTaskBoundary } from "@/utils/node-meta";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "@/utils/status-mapping";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { ContextMenuAction } from "./NodeContextMenu";
import {
  addTagToTask,
  removeTagFromTask,
  updateTask,
  addTaskDependency,
  removeTaskDependency,
} from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal, updateGoal } from "@/api/goals";
import { listDomains, updateDomain } from "@/api/domains";
import type { Domain } from "@/api/domains";
import MindmapCanvas from "./MindmapCanvas";
import SubtreeNavPill from "./SubtreeNavPill";
import StatusToast from "./StatusToast";
import TaskEditorModal from "./TaskEditorModal";
import type { TaskSaveData } from "./TaskEditorModal";
import GoalEditorModal from "./GoalEditorModal";
import type { GoalSaveData } from "./GoalEditorModal";
import DomainEditorModal from "./DomainEditorModal";
import ProjectEditorModal from "./ProjectEditorModal";
import type { ProjectSaveData } from "./ProjectEditorModal";
import TagEditorModal from "./TagEditorModal";
import WarningConfirmModal from "./WarningConfirmModal";
import type { WarningAction } from "./WarningConfirmModal";
import styles from "./MindmapView.module.css";

function nextTaskStatus(current: string): "todo" | "in_progress" | "done" {
  if (current === "in_progress") return "done";
  if (current === "done") return "todo";
  return "in_progress";
}

function collectTasksAndGoals(node: MindmapNode, acc: MindmapNode[]): void {
  if (node.kind === "task" || node.kind === "goal") acc.push(node);
  for (const child of node.children) collectTasksAndGoals(child, acc);
}

export default function MindmapView() {
  const { tree, isLoading, error, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, reload } =
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
  const [warningModal, setWarningModal] = useState<{
    nodeId: string;
    fromKind: NodeKind;
    toKind: NodeKind;
    heading: string;
    consequences: string[];
    hasGoalChildren: boolean;
  } | null>(null);

  useEffect(() => {
    void listDomains("tag").then(setAllTags);
  }, []);

  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);

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
      const target = nearestInDirection(selectedNodeId, positions, key);
      if (target !== undefined) selectNode(target);
    },
    [selectedNodeId, positions, selectNode],
  );

  const confirmRetype = useCallback(
    (options?: RetypeOptions) => {
      if (warningModal === null) return;
      void retypeNode(warningModal.nodeId, warningModal.fromKind, warningModal.toKind, options);
      setWarningModal(null);
    },
    [warningModal, retypeNode],
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
        const newStatus =
          node.kind === "goal"
            ? goalStatusToTaskStatus(node.status ?? "active")
            : taskStatusToGoalStatus(node.status ?? "todo");
        showToast({ nodeId, message: `Status: ${node.status ?? "—"} → ${newStatus}` });

        const hasGoalChildren = node.kind === "goal" && node.children.some((c) => c.kind === "goal");
        const hasAnyChildren = node.children.length > 0;
        const hasBlockedReason = node.blockedReason != null && node.blockedReason !== "";

        if (hasGoalChildren || hasAnyChildren || hasBlockedReason) {
          const consequences: string[] = [];
          if (hasBlockedReason) {
            const reason = node.blockedReason ?? "";
            const preview = reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
            consequences.push(`Block reason will carry over: "${preview}"`);
          }
          if (hasGoalChildren) {
            const count = node.children.filter((c) => c.kind === "goal").length;
            consequences.push(`${count} sub-goal${count > 1 ? "s" : ""} cannot live under a task — choose what happens to them`);
          } else if (hasAnyChildren) {
            const count = node.children.length;
            consequences.push(`${count} child${count > 1 ? "ren" : ""} will re-parent to the new ${newKind}`);
          }
          setWarningModal({ nodeId, fromKind: node.kind, toKind: newKind, heading: `Convert to ${newKind}?`, consequences, hasGoalChildren });
          return;
        }
      }

      void retypeNode(nodeId, node.kind, newKind);
    },
    [findNodeById, tree, showToast, retypeNode],
  );

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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (editingNodeId !== null) return;
      if (editorModal !== null) return;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          navigateArrow("ArrowLeft");
          break;
        case "ArrowRight":
          event.preventDefault();
          navigateArrow("ArrowRight");
          break;
        case "ArrowUp":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) {
            cycleType(selectedNodeId, -1);
          } else if (event.altKey && selectedNodeId !== null) {
            void reorderNode(selectedNodeId, -1);
          } else {
            navigateArrow("ArrowUp");
          }
          break;
        case "ArrowDown":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) {
            cycleType(selectedNodeId, 1);
          } else if (event.altKey && selectedNodeId !== null) {
            void reorderNode(selectedNodeId, 1);
          } else {
            navigateArrow("ArrowDown");
          }
          break;
        case "F2":
          event.preventDefault();
          if (selectedNodeId !== null) {
            const f2Node = findNodeById(selectedNodeId);
            if (f2Node !== undefined && f2Node.kind !== "aspect") {
              setEditingNodeId(selectedNodeId);
            }
          }
          break;
        case "Tab": {
          event.preventDefault();
          const tabNode = selectedNodeId !== null ? findNodeById(selectedNodeId) : undefined;
          if (tabNode !== undefined && tabNode.id.includes("-") && tabNode.kind !== "tag") {
            (async () => {
              try {
                const newNode = await createChild(selectedNodeId!, tabNode.kind, "");
                setEditingNodeId(newNode.id);
              } catch (err) {
                console.error("[arlesh] Tab createChild failed:", err);
              }
            })();
          }
          break;
        }
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
      reorderNode,
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
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  useEffect(() => {
    function handleShiftEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && event.shiftKey) exitToRoot();
    }
    window.addEventListener("keydown", handleShiftEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleShiftEscape, { capture: true });
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

  const handleTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);

      await updateTask(dbId, {
        title: data.title,
        status: data.status,
        blocked_reason: data.blockedReason,
      });

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

      await updateGoal(dbId, {
        title: data.title,
        status: data.status,
        blocked_reason: data.blockedReason,
      });

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
      if (target.kind === "aspect" || target.kind === "task" || target.kind === "tag") return;
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

  const availableForDep =
    editorModal !== null
      ? allTasksAndGoals.filter((n) => n.id !== editorModal.nodeId)
      : [];

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
        onDragStart={(id) => {
          setDragSourceId(id);
          setDragTargetId(null);
        }}
        onDrop={handleDrop}
        onCanvasClick={() => selectNode(null)}
        onStatusClick={handleStatusClick}
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

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal
          node={editorModal.node}
          allTags={allTags}
          availableForDep={availableForDep}
          onSave={handleTaskSave}
          onClose={() => setEditorModal(null)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "goal" && (
        <GoalEditorModal
          node={editorModal.node}
          allTags={allTags}
          onSave={handleGoalSave}
          onClose={() => setEditorModal(null)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "domain" && (
        <DomainEditorModal
          title={editorModal.node.title}
          onSave={handleSimpleSave}
          onClose={() => setEditorModal(null)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "project" && (
        <ProjectEditorModal
          node={editorModal.node}
          onSave={handleProjectSave}
          onClose={() => setEditorModal(null)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "tag" && (
        <TagEditorModal
          title={editorModal.node.title}
          onSave={handleSimpleSave}
          onClose={() => setEditorModal(null)}
        />
      )}

      {warningModal !== null && (
        <WarningConfirmModal
          heading={warningModal.heading}
          consequences={warningModal.consequences}
          actions={buildRetypeActions(warningModal.hasGoalChildren, warningModal.toKind, confirmRetype)}
          onCancel={() => setWarningModal(null)}
        />
      )}
    </div>
  );
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
  return [
    { label: `Convert to ${toKind}`, variant: "primary", onClick: () => { confirm(); } },
  ];
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

/**
 * Finds the nearest visible node in a screen direction from `fromId`.
 *
 * Score = primaryDistance + 2 * secondaryDeviation so that well-aligned
 * neighbours beat distant ones even if they're slightly off-axis.
 */
function nearestInDirection(
  fromId: string,
  positions: Map<string, import("@/utils/tree-layout").Position>,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): string | undefined {
  const from = positions.get(fromId);
  if (from === undefined) return undefined;

  let bestId: string | undefined;
  let bestScore = Infinity;

  for (const [id, pos] of positions) {
    if (id === fromId) continue;

    const dx = pos.x - from.x;
    const dy = pos.y - from.y;

    let primary: number;
    let secondary: number;

    switch (direction) {
      case "ArrowRight": if (dx <= 0) continue; primary = dx;  secondary = Math.abs(dy); break;
      case "ArrowLeft":  if (dx >= 0) continue; primary = -dx; secondary = Math.abs(dy); break;
      case "ArrowDown":  if (dy <= 0) continue; primary = dy;  secondary = Math.abs(dx); break;
      case "ArrowUp":    if (dy >= 0) continue; primary = -dy; secondary = Math.abs(dx); break;
    }

    const score = primary + 2 * secondary;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return bestId;
}
