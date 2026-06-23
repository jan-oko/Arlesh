import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMindmapData } from "@/hooks/use-mindmap-data";
import type { RetypeOptions } from "@/hooks/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { computeLayout, computeSubtreeLayout, HORIZONTAL_GAP, VERTICAL_GAP } from "@/utils/tree-layout";
import { validTypesForCycling, crossesGoalTaskBoundary, isValidDropTarget, getNodeSize } from "@/utils/node-meta";
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
import DragGhost from "./DragGhost";
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
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const dragGestureRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    committed: boolean;
  } | null>(null);
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

  useEffect(() => {
    const DRAG_THRESHOLD = 4;

    function nodeIdAtPoint(x: number, y: number): string | null {
      // elementFromPoint returns the topmost visual leaf (e.g. <rect>, <text>).
      // closest() then walks up the DOM to find the <g data-node-id="..."> ancestor.
      const el = document.elementFromPoint(x, y);
      return el?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    }

    function handleMouseMove(e: MouseEvent) {
      const gesture = dragGestureRef.current;
      if (gesture === null) return;

      if (!gesture.committed) {
        if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD) return;
        gesture.committed = true;
        setDragSourceId(gesture.nodeId);
        document.body.style.cursor = "grabbing";
      }

      setGhostPos({ x: e.clientX, y: e.clientY });

      const targetId = nodeIdAtPoint(e.clientX, e.clientY);
      if (targetId === null || targetId === gesture.nodeId) {
        setDragTargetId(null);
        return;
      }
      const source = findNode(tree, gesture.nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined) {
        setDragTargetId(null);
        return;
      }
      const sourceSubtree = findNode(tree, gesture.nodeId);
      const isDescendant = sourceSubtree !== undefined && findNode(sourceSubtree, targetId) !== undefined;
      setDragTargetId(!isDescendant && isValidDropTarget(source.kind, target.kind) ? targetId : null);
    }

    function handleMouseUp(e: MouseEvent) {
      const gesture = dragGestureRef.current;
      if (gesture === null) return;
      dragGestureRef.current = null;
      document.body.style.cursor = "";
      setDragSourceId(null);
      setGhostPos(null);
      setDragTargetId(null);

      if (!gesture.committed) return;

      const targetId = nodeIdAtPoint(e.clientX, e.clientY);

      if (targetId === null || targetId === gesture.nodeId) return;
      const source = findNode(tree, gesture.nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined) return;
      const sourceSubtree = findNode(tree, gesture.nodeId);
      if (sourceSubtree !== undefined && findNode(sourceSubtree, targetId) !== undefined) return;
      if (!isValidDropTarget(source.kind, target.kind)) return;
      const siblingPositions = target.children
        .filter((c) => c.id !== gesture.nodeId)
        .map((c) => c.position);
      const lastPosition = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      void moveNode(gesture.nodeId, source.kind, targetId, target.kind, lastPosition);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tree, moveNode]);

  const displayRoot = useMemo<MindmapNode>(
    () => (subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree),
    [subtreeRootId, tree],
  );

  // During drag, treat the source node as collapsed so its children vanish from the live tree.
  const effectiveCollapsedIds = useMemo<ReadonlySet<string>>(
    () => {
      if (dragSourceId === null) return collapsedNodeIds;
      const s = new Set(collapsedNodeIds);
      s.add(dragSourceId);
      return s;
    },
    [collapsedNodeIds, dragSourceId],
  );

  const positions = useMemo(
    () => computeLayout(displayRoot, effectiveCollapsedIds),
    [displayRoot, effectiveCollapsedIds],
  );

  // Layout the dragged subtree (all children) relative to its root at (0,0),
  // all children forced to the same side as the drop target.
  const subtreeLayout = useMemo(() => {
    if (dragSourceId === null || dragTargetId === null) return null;
    const sourceNode = findNode(tree, dragSourceId);
    if (sourceNode === undefined || sourceNode.children.length === 0) return null;
    const targetPos = positions.get(dragTargetId);
    const direction: 1 | -1 = (targetPos?.x ?? 0) >= 0 ? 1 : -1;
    return computeSubtreeLayout(sourceNode, collapsedNodeIds, direction);
  }, [dragSourceId, dragTargetId, tree, collapsedNodeIds, positions]);

  // Compute where the dragged node would land as the last child of the drop target.
  const placeholderPos = (() => {
    if (dragTargetId === null || dragSourceId === null) return null;
    const targetPos = positions.get(dragTargetId);
    if (targetPos === undefined) return null;
    const direction: 1 | -1 = targetPos.x >= 0 ? 1 : -1;
    const childX = targetPos.x + direction * HORIZONTAL_GAP;
    const childDepth = targetPos.depth + 1;
    const targetNode = findNode(tree, dragTargetId);
    if (targetNode === undefined) return { x: childX, y: targetPos.y, depth: childDepth };
    const visibleChildren = targetNode.children.filter(
      (c) => !collapsedNodeIds.has(c.id) && c.id !== dragSourceId,
    );
    if (visibleChildren.length === 0) return { x: childX, y: targetPos.y, depth: childDepth };
    const yValues = visibleChildren
      .map((c) => positions.get(c.id)?.y)
      .filter((v): v is number => v !== undefined);
    const bottomY = yValues.length > 0 ? Math.max(...yValues) : targetPos.y;
    // Shift the placeholder down enough that the topmost child of the dragged
    // subtree clears the current bottom sibling by at least VERTICAL_GAP.
    let topSpread = 0;
    if (subtreeLayout !== null) {
      for (const p of subtreeLayout.values()) {
        if (p.y < 0) topSpread = Math.max(topSpread, -p.y);
      }
    }
    return { x: childX, y: bottomY + VERTICAL_GAP + topSpread, depth: childDepth };
  })();

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
      const { nodeId, fromKind, toKind } = warningModal;
      setWarningModal(null);
      void retypeNode(nodeId, fromKind, toKind, options).then((newId) => {
        selectNode(newId ?? nodeId);
      });
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
        const newStatus =
          node.kind === "goal"
            ? goalStatusToTaskStatus(node.status ?? "active")
            : taskStatusToGoalStatus(node.status ?? "todo");
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

      void retypeNode(nodeId, node.kind, newKind).then((newId) => {
        selectNode(newId ?? nodeId);
      });
    },
    [findNodeById, tree, showToast, retypeNode, selectNode],
  );

  const pasteClipboard = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const sourceNode = findNodeById(clipboard.nodeId);
      const targetNode = findNodeById(targetId);
      if (sourceNode === undefined || targetNode === undefined) return;
      const pasteSiblingPositions = targetNode.children
        .filter((c) => c.id !== clipboard.nodeId)
        .map((c) => c.position);
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
      if (warningModal !== null) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setWarningModal(null);
        }
        return;
      }

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
                selectNode(newNode.id);
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
      warningModal,
      setWarningModal,
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
        collapsedNodeIds={effectiveCollapsedIds}
        selectedNodeId={selectedNodeId}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        dragSourceId={dragSourceId}
        hasClipboard={clipboard !== null}
        canvasOverlay={placeholderPos !== null && dragTargetId !== null ? (() => {
          const fromPos = positions.get(dragTargetId);
          const { width, height } = getNodeSize(placeholderPos.depth);
          const edgePath = fromPos !== undefined ? (() => {
            const fromSize = getNodeSize(fromPos.depth);
            const goingRight = placeholderPos.x >= fromPos.x;
            const fromX = fromPos.x + (goingRight ? fromSize.width / 2 : -fromSize.width / 2);
            const toX = placeholderPos.x + (goingRight ? -width / 2 : width / 2);
            const midX = (fromX + toX) / 2;
            return `M ${fromX} ${fromPos.y} C ${midX} ${fromPos.y}, ${midX} ${placeholderPos.y}, ${toX} ${placeholderPos.y}`;
          })() : null;

          // Collect child/grandchild nodes and internal edges for the subtree preview.
          const subtreeNodes: Array<{ id: string; x: number; y: number; depthAbs: number }> = [];
          const subtreeEdges: Array<{ key: string; fx: number; fy: number; fdepth: number; tx: number; ty: number; tdepth: number }> = [];
          if (subtreeLayout !== null && dragSourceId !== null) {
            const sourceNode = findNode(tree, dragSourceId);
            if (sourceNode !== undefined) {
              gatherSubtreeItems(
                sourceNode, subtreeLayout, collapsedNodeIds,
                placeholderPos.x, placeholderPos.y, placeholderPos.depth,
                true, subtreeNodes, subtreeEdges,
              );
            }
          }

          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Connector from drop-target to placeholder root */}
              {edgePath !== null && (
                <path d={edgePath} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 3" fill="none" opacity={0.7} />
              )}
              {/* Placeholder rect for the dragged node itself */}
              <g transform={`translate(${placeholderPos.x - width / 2}, ${placeholderPos.y - height / 2})`}>
                <rect width={width} height={height} rx={6} fill="var(--accent)" fillOpacity={0.1} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 3" />
              </g>
              {/* Internal edges of the subtree */}
              {subtreeEdges.map((edge) => {
                const fromSize = getNodeSize(edge.fdepth);
                const toSize = getNodeSize(edge.tdepth);
                const goingRight = edge.tx >= edge.fx;
                const ex = edge.fx + (goingRight ? fromSize.width / 2 : -fromSize.width / 2);
                const ex2 = edge.tx + (goingRight ? -toSize.width / 2 : toSize.width / 2);
                const emx = (ex + ex2) / 2;
                return (
                  <path
                    key={edge.key}
                    d={`M ${ex} ${edge.fy} C ${emx} ${edge.fy}, ${emx} ${edge.ty}, ${ex2} ${edge.ty}`}
                    stroke="var(--accent)"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    fill="none"
                    opacity={0.55}
                  />
                );
              })}
              {/* Placeholder rects for each child/grandchild */}
              {subtreeNodes.map((n) => {
                const sz = getNodeSize(n.depthAbs);
                return (
                  <g key={n.id} transform={`translate(${n.x - sz.width / 2}, ${n.y - sz.height / 2})`}>
                    <rect width={sz.width} height={sz.height} rx={6} fill="var(--accent)" fillOpacity={0.07} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 2" />
                  </g>
                );
              })}
            </g>
          );
        })() : undefined}
        onSelect={selectNode}
        onDoubleClick={handleDoubleClick}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingNodeId(null)}
        onContextAction={handleContextAction}
        onDragStart={(id, startX, startY) => {
          dragGestureRef.current = { nodeId: id, startX, startY, committed: false };
        }}
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

      {dragSourceId !== null && ghostPos !== null && (() => {
        const sourceNode = findNode(tree, dragSourceId);
        if (sourceNode === undefined) return null;
        const depth = positions.get(dragSourceId)?.depth ?? 0;
        return <DragGhost node={sourceNode} depth={depth} x={ghostPos.x} y={ghostPos.y} />;
      })()}
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

/** Collects absolute positions + edge geometry for the drag placeholder subtree preview. */
function gatherSubtreeItems(
  node: MindmapNode,
  layout: Map<string, import("@/utils/tree-layout").Position>,
  collapsedIds: ReadonlySet<string>,
  ox: number,
  oy: number,
  depthOffset: number,
  isRoot: boolean,
  nodes: Array<{ id: string; x: number; y: number; depthAbs: number }>,
  edges: Array<{ key: string; fx: number; fy: number; fdepth: number; tx: number; ty: number; tdepth: number }>,
): void {
  const relPos = layout.get(node.id);
  if (relPos === undefined) return;
  const absX = ox + relPos.x;
  const absY = oy + relPos.y;
  const depthAbs = depthOffset + relPos.depth;
  if (!isRoot) {
    nodes.push({ id: node.id, x: absX, y: absY, depthAbs });
  }
  if (collapsedIds.has(node.id)) return;
  for (const child of node.children) {
    const childRel = layout.get(child.id);
    if (childRel === undefined) continue;
    const cx = ox + childRel.x;
    const cy = oy + childRel.y;
    const cd = depthOffset + childRel.depth;
    edges.push({ key: `${node.id}-${child.id}`, fx: absX, fy: absY, fdepth: depthAbs, tx: cx, ty: cy, tdepth: cd });
    gatherSubtreeItems(child, layout, collapsedIds, ox, oy, depthOffset, false, nodes, edges);
  }
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
