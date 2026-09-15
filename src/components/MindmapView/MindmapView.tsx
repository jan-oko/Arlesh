import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "./use-mindmap-data";
import type { LoadCondition } from "./use-mindmap-data";
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
import { getErrorMessage } from "@/api/errors";
import { findNode, findParent, collectTasksAndGoals, collectSubtreePostOrder, computeShiftSelectRange, conversionNeedsConfirm, canConvertNodeToFlow, collectSearchableNodes } from "@/utils/mindmap-tree";
import MindmapCanvas, { type MindmapCanvasHandle } from "@/components/MindmapCanvas/MindmapCanvas";
import DragGhost from "@/components/DragGhost/DragGhost";
import DragPlaceholder from "@/components/DragPlaceholder/DragPlaceholder";
import { useFilterStore } from "@/stores/use-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { filterTree } from "@/utils/filter-tree";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import HabitFailureBanner from "@/components/HabitFailureBanner/HabitFailureBanner";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import InfoEditorModal from "@/components/InfoEditorModal/InfoEditorModal";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import FlowEditorModal, { type FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import FlowItemEditorModal from "@/components/FlowItemEditorModal/FlowItemEditorModal";
import StartFlowModal, { type StartFlowData } from "@/components/StartFlowModal/StartFlowModal";
import { startFlow, convertToFlow } from "@/api/flows";
import ConvertToFlowModal from "@/components/ConvertToFlowModal/ConvertToFlowModal";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import styles from "./MindmapView.module.css";

/** Screen-px moved per arrow-key press when panning the canvas (nothing selected). */
const KEYBOARD_PAN_STEP = 80;

// A pristine flow used to seed the create editor before the flow is persisted.
const BLANK_FLOW_NODE: MindmapNode = {
  id: "flow-new", kind: "flow", title: "", position: 0,
  flow: { instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: false, rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null },
  tagIds: [], children: [],
};

export default function MindmapView() {
  const { t } = useTranslation(["common", "editor", "warnings", "nodeKinds"]);
  const { tree, isLoading, error, loadCondition, createNode, createChild, renameNode, retypeNode, reorderNode, moveNode, removeNode, createFlow, reload } =
    useMindmapData();
  const {
    selectedNodeId, selectedNodeIds, subtreeRootId, clipboard, collapsedNodeIds, pendingToast,
    selectNode, addToSelection, setSelection, enterSubtree, exitSubtree, exitToRoot,
    setClipboard, toggleCollapsed, showToast, clearToast, setSubtreeNav,
  } = useMindmapStore();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The load condition banner is dismissable for the session, but a dismissal only ever
  // suppresses the exact condition instance shown when it was dismissed — a later load, even one
  // with the same failures, produces a new `LoadCondition` object and the banner returns.
  const [dismissedLoadCondition, setDismissedLoadCondition] = useState<LoadCondition | null>(null);
  const showHabitBanner = loadCondition.failedFlows.length > 0 && loadCondition !== dismissedLoadCondition;
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [flowCreateParent, setFlowCreateParent] = useState<{ id: string; kind: NodeKind } | null>(null);
  const [startFlowNode, setStartFlowNode] = useState<MindmapNode | null>(null);
  const [convertNode, setConvertNode] = useState<MindmapNode | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const findNodeById = useCallback((id: string): MindmapNode | undefined => findNode(tree, id), [tree]);
  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);
  const mindmapOrientation = useViewStore((s) => s.mindmapOrientation);
  // The cheat-sheet overlay gates background shortcuts the same way an open modal does.
  const isInputCaptured = useIsInputCaptured();
  const filter = useFilterStore((s) => s.filter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  const displayRoot = useMemo<MindmapNode>(() => {
    const base = subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree;
    return filterTree(base, filter);
  }, [subtreeRootId, tree, filter]);

  const canvasRef = useRef<MindmapCanvasHandle>(null);

  useEffect(() => {
    if (subtreeRootId !== null) canvasRef.current?.centerOnRoot();
  }, [subtreeRootId]);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onGoalSave, onSimpleSave, onProjectSave, onInfoSave, onFlowSave, onFlowItemSave,
    checkScopeClamp, confirmScopeClamp, scopeClampRequest, resolveScopeClamp,
  } = useNodeEditor({ tree, allTasksAndGoals, reload });

  // Every flow item, used to offer intra-flow dependency targets within the same flow.
  const allFlowItems = useMemo(() => {
    const acc: MindmapNode[] = [];
    const walk = (node: MindmapNode) => {
      if (node.kind === "flow_goal" || node.kind === "flow_task") acc.push(node);
      node.children.forEach(walk);
    };
    walk(tree);
    return acc;
  }, [tree]);

  // Nodes a Flow may target — those that can hold a Goal/Task instance. Phase 7.5 further
  // narrows this to targets whose Time Scope satisfies containment.
  const flowTargets = useMemo(() => {
    const canHoldInstance = new Set<NodeKind>(["aspect", "domain", "project", "goal", "task"]);
    const acc: MindmapNode[] = [];
    const walk = (node: MindmapNode) => {
      if (node.id !== "root" && canHoldInstance.has(node.kind)) acc.push(node);
      node.children.forEach(walk);
    };
    walk(tree);
    return acc;
  }, [tree]);

  // Opens a blank flow editor scoped to the chosen parent; the flow is persisted only on save.
  const onNewFlow = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setFlowCreateParent({ id: parentId, kind: parent.kind });
    },
    [tree],
  );

  // Runs the conversion, reloads, then opens the new flow's editor so it can be configured.
  const runConvertToFlow = useCallback(
    async (node: MindmapNode, keepDependencies: boolean, mapScopes: boolean) => {
      const dbId = parseInt(node.id.split("-").pop() ?? "0", 10);
      const flow = await convertToFlow(node.kind, dbId, keepDependencies, mapScopes);
      await reload();
      const flowNode: MindmapNode = {
        id: `flow-${flow.id}`,
        kind: "flow",
        title: flow.title,
        flow: {
          instanceType: flow.instance_type,
          targetType: flow.target_type,
          targetId: flow.target_id,
          durationN: flow.flow_duration_n,
          durationKind: flow.flow_duration_kind,
          windowPart: flow.flow_window_part,
          windowTimeStart: flow.flow_window_time_start,
          windowTimeEnd: flow.flow_window_time_end,
          isHabit: flow.is_habit,
          rootPlanKind: flow.root_plan_kind,
          rootPlanStart: flow.root_plan_start,
          rootPlanEnd: flow.root_plan_end,
        },
        position: flow.position,
        tagIds: [],
        children: [],
      };
      selectNode(flowNode.id);
      setEditorModal({ nodeId: flowNode.id, node: flowNode });
    },
    [reload, selectNode, setEditorModal],
  );

  // A subtree with children prompts (destructive); a childless node converts straight away.
  const onConvertToFlow = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      if (conversionNeedsConfirm(node)) {
        setConvertNode(node);
        return;
      }
      void runConvertToFlow(node, true, true).catch((err: unknown) =>
        showToast({ nodeId, message: getErrorMessage(err) }),
      );
    },
    [tree, runConvertToFlow, showToast],
  );

  // From the confirm prompt: run with the chosen toggles. Errors propagate back to the modal.
  const handleConvertToFlow = useCallback(
    async (keepDependencies: boolean, mapScopes: boolean) => {
      if (convertNode === null) return;
      await runConvertToFlow(convertNode, keepDependencies, mapScopes);
      setConvertNode(null);
    },
    [convertNode, runConvertToFlow],
  );

  // Persists a brand-new flow under the pending parent, then closes the create editor.
  const onCreateFlow = useCallback(
    async (data: FlowSaveData) => {
      if (flowCreateParent === null) return;
      const parentDbId = parseInt(flowCreateParent.id.split("-").pop() ?? "0", 10);
      await createFlow({
        title: data.title,
        instance_type: data.instanceType,
        parent_type: flowCreateParent.kind,
        parent_id: parentDbId,
        target_type: data.targetType,
        target_id: data.targetId,
        flow_duration_n: data.durationN,
        flow_duration_kind: data.durationKind,
        flow_window_part: data.windowPart,
        flow_window_time_start: data.windowTimeStart,
        flow_window_time_end: data.windowTimeEnd,
        root_plan_kind: data.rootPlanKind,
        root_plan_start: data.rootPlanStart,
        root_plan_end: data.rootPlanEnd,
      });
      setFlowCreateParent(null);
    },
    [flowCreateParent, createFlow],
  );

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
    displayRoot, tree, collapsedNodeIds, dragSourceId, dragTargetId, orientation: mindmapOrientation,
  });

  // Follow the selection: when it *changes* to a node off the visible canvas (e.g. arrow navigation),
  // pan to it. Guarded on an actual selection change so layout shifts under a stable selection don't pan.
  const prevSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (selectedNodeId !== null && selectedNodeId !== prevSelectedId.current) {
      const pos = positions.get(selectedNodeId);
      if (pos !== undefined) canvasRef.current?.ensureVisible(pos.x, pos.y);
    }
    prevSelectedId.current = selectedNodeId;
  }, [selectedNodeId, positions]);

  // When the filter (or any layout change) leaves nothing on screen, recenter on the root.
  useEffect(() => {
    if (positions.size === 0) return;
    const vp = canvasRef.current?.getViewport();
    if (vp === undefined) return;
    for (const p of positions.values()) {
      const sx = vp.x + p.x * vp.scale;
      const sy = vp.y + p.y * vp.scale;
      if (sx >= 0 && sx <= vp.width && sy >= 0 && sy <= vp.height) return; // something is visible
    }
    canvasRef.current?.centerOnRoot();
  }, [positions]);

  // Flipping the orientation relocates every node, so the viewport would otherwise be left looking
  // at empty canvas. Pan to whatever was in focus — the selection, or the display root without one.
  // Declared after the recenter-on-empty effect above so this wins when both fire in one commit.
  const prevOrientation = useRef(mindmapOrientation);
  useEffect(() => {
    if (mindmapOrientation === prevOrientation.current) return;
    prevOrientation.current = mindmapOrientation;
    const pos = positions.get(selectedNodeId ?? displayRoot.id);
    if (pos !== undefined) canvasRef.current?.centerOnPoint(pos.x, pos.y);
  }, [mindmapOrientation, selectedNodeId, displayRoot, positions]);

  const { warningModal, setWarningModal, cycleType, setType, retypeActions } = useNodeTypeManager({
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
      .catch((err: unknown) => { setDeleteError(getErrorMessage(err)); })
      .finally(() => setIsDeleting(false));
  }, [deleteTargets, tree, removeNode, selectNode]);

  const subtreeParent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const subtreeParentId = subtreeParent !== null && subtreeParent.id !== "root" ? subtreeParent.id : null;

  // Publish the back-nav descriptor to the store so the top bar can render the pills (it lacks the tree).
  useEffect(() => {
    setSubtreeNav(
      subtreeRootId === null
        ? null
        : { rootTitle: tree.title, parentTitle: subtreeParent?.title ?? tree.title, parentSubtreeId: subtreeParentId },
    );
  }, [subtreeRootId, tree, subtreeParent, subtreeParentId, setSubtreeNav]);
  const handleExitSubtree = useCallback(() => exitSubtree(subtreeParentId), [exitSubtree, subtreeParentId]);

  const { onStatusClick, onCommitEdit, onCreateChild, onCreateSibling, onInsertParent, onDelete, onPaste } = useNodeActions({
    tree, clipboard, moveNode, onRequestDelete: setDeleteTargets, reload, renameNode,
    createNode, createChild, selectNode, setClipboard, setEditingNodeId,
  });

  const { navigateArrow, extendSelection } = useNavigateArrow({ selectedNodeId, selectedNodeIds, positions, tree, orientation: mindmapOrientation, selectNode, setSelection });

  // Arrow keys with no node focused pan the view itself instead of moving a selection.
  const onPanCanvas = useCallback((key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => {
    switch (key) {
      case "ArrowLeft": canvasRef.current?.panBy(KEYBOARD_PAN_STEP, 0); break;
      case "ArrowRight": canvasRef.current?.panBy(-KEYBOARD_PAN_STEP, 0); break;
      case "ArrowUp": canvasRef.current?.panBy(0, KEYBOARD_PAN_STEP); break;
      case "ArrowDown": canvasRef.current?.panBy(0, -KEYBOARD_PAN_STEP); break;
    }
  }, []);

  // Pans the canvas so the selected node sits at the viewport centre.
  const onCenterOnSelected = useCallback(
    (nodeId: string) => {
      const pos = positions.get(nodeId);
      if (pos !== undefined) canvasRef.current?.centerOnPoint(pos.x, pos.y);
    },
    [positions],
  );

  // Keyboard variant of the "Convert to Flow" context-menu action: no-ops on a node that
  // isn't eligible (only a Goal/Task parented where a Flow may live).
  const onConvertToFlowKey = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      const parent = findParent(tree, nodeId);
      if (!canConvertNodeToFlow(node.kind, parent?.kind ?? null)) return;
      onConvertToFlow(nodeId);
    },
    [tree, onConvertToFlow],
  );

  // Opens the start-flow modal for a focused flow node.
  const onStartFlow = useCallback(
    (flowId: string) => {
      const node = findNode(tree, flowId);
      if (node === undefined || node.kind !== "flow") return;
      setStartFlowNode(node);
    },
    [tree],
  );

  // Materializes the flow under the chosen target, then selects the new root.
  const onConfirmStartFlow = useCallback(
    async (data: StartFlowData) => {
      if (startFlowNode === null) return;
      const flowDbId = parseInt(startFlowNode.id.split("-").pop() ?? "0", 10);
      const result = await startFlow(flowDbId, {
        title: data.title, target_type: data.targetType, target_id: data.targetId, anchor_date: data.anchorDate,
      });
      setStartFlowNode(null);
      await reload();
      selectNode(`${result.root_type}-${result.root_id}`);
    },
    [startFlowNode, reload, selectNode],
  );

  const { onContextAction } = useContextAction({
    findNodeById, enterSubtree, setEditingNodeId, setType,
    setClipboard, clipboard, onPaste, toggleCollapsed, onDelete, onNewFlow, onConvertToFlow, onStartFlow,
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
    isInputActive: isInputCaptured,
    isWarningActive: warningModal !== null,
    onDismissWarning: () => setWarningModal(null),
    selectedNodeId,
    selectedNodeIds,
    subtreeRootId,
    clipboard,
    orientation: mindmapOrientation,
    onNavigate: navigateArrow,
    onPanCanvas,
    onCycleType: cycleType,
    onReorder: (id, dir) => { void reorderNode(id, dir); },
    onStartRename: setEditingNodeId,
    onCreateChild,
    onCreateSibling,
    onInsertParent,
    onOpenEditor: onDoubleClick,
    onStartFlow,
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
    onOpenSearch: () => setNodeSearchOpen(true),
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onToggleFilter: toggleFilterPopover,
    onSetStatusMode: setStatusMode,
    onFocusRoot: () => selectNode(subtreeRootId ?? tree.id),
    onCenterOnNode: onCenterOnSelected,
    onConvertToFlow: onConvertToFlowKey,
    onExtendSelection: extendSelection,
    findNodeById,
  });
  const targetPos = dragTargetId !== null ? positions.get(dragTargetId) : undefined;

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
      {showHabitBanner && (
        <HabitFailureBanner
          failedFlows={loadCondition.failedFlows}
          onDismiss={() => setDismissedLoadCondition(loadCondition)}
        />
      )}
      <MindmapCanvas
        ref={canvasRef}
        root={displayRoot}
        orientation={mindmapOrientation}
        collapsedNodeIds={effectiveCollapsedIds}
        selectedNodeIds={selectedNodeIds}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        dragSourceId={dragSourceId}
        hasClipboard={clipboard !== null}
        canvasOverlay={placeholderPos !== null && targetPos !== undefined ? (
          <DragPlaceholder placeholderPos={placeholderPos} targetPos={targetPos} subtreeLayout={subtreeLayout} collapsedNodeIds={collapsedNodeIds} dragSourceId={dragSourceId} orientation={mindmapOrientation} tree={tree} />
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


      <AnchoredToast toast={pendingToast} positions={positions} onDismiss={clearToast} />

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal node={editorModal.node} allTags={allTags} domainNames={domainNames} availableForDep={availableForDep} onSave={onTaskSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "goal" && (
        <GoalEditorModal node={editorModal.node} allTags={allTags} domainNames={domainNames} onSave={onGoalSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "domain" && (
        <TitleEditorModal heading={t("editor:editDomain")} title={editorModal.node.title} isPrivate={editorModal.node.isPrivate ?? false} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "project" && (
        <ProjectEditorModal node={editorModal.node} onSave={onProjectSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "tag" && (
        <TitleEditorModal heading={t("editor:editTag")} title={editorModal.node.title} isPrivate={editorModal.node.isPrivate ?? false} onSave={onSimpleSave} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "info" && (
        <InfoEditorModal node={editorModal.node} onSave={onInfoSave} onClose={() => setEditorModal(null)} />
      )}
      {nodeSearchOpen && (
        <NodeSearchModal
          nodes={collectSearchableNodes(tree)}
          onSelect={(id) => { enterSubtree(id); setNodeSearchOpen(false); }}
          onClose={() => setNodeSearchOpen(false)}
        />
      )}
      {editorModal !== null && editorModal.node.kind === "flow" && (
        <FlowEditorModal node={editorModal.node} availableTargets={flowTargets} onSave={onFlowSave} onClose={() => setEditorModal(null)} />
      )}
      {flowCreateParent !== null && (
        <FlowEditorModal node={BLANK_FLOW_NODE} availableTargets={flowTargets} heading={t("editor:newFlowTitle")} onSave={onCreateFlow} onClose={() => setFlowCreateParent(null)} />
      )}
      {startFlowNode !== null && (
        <StartFlowModal
          flowTitle={startFlowNode.title}
          flowScoped={startFlowNode.flow?.durationKind != null}
          durationN={startFlowNode.flow?.durationN ?? null}
          durationKind={startFlowNode.flow?.durationKind ?? null}
          defaultTargetType={startFlowNode.flow?.targetType ?? null}
          defaultTargetId={startFlowNode.flow?.targetId ?? null}
          availableTargets={flowTargets}
          onStart={onConfirmStartFlow}
          onClose={() => setStartFlowNode(null)}
        />
      )}
      {convertNode !== null && (
        <ConvertToFlowModal
          title={convertNode.title}
          onConvert={handleConvertToFlow}
          onClose={() => setConvertNode(null)}
        />
      )}
      {editorModal !== null && (editorModal.node.kind === "flow_goal" || editorModal.node.kind === "flow_task") && (
        <FlowItemEditorModal
          node={editorModal.node}
          availableDeps={allFlowItems.filter((n) => n.flowItem?.flowId === editorModal.node.flowItem?.flowId && n.id !== editorModal.node.id)}
          onSave={onFlowItemSave}
          onClose={() => setEditorModal(null)}
        />
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
          consequences={scopeClampRequest.conflicts.map((c) => {
            const item = t("warnings:scopeClampItem", {
              type: c.node_type === "goal" ? t("nodeKinds:goal") : t("nodeKinds:task"),
              id: c.node_id,
            });
            const flow = scopeClampRequest.flowOrigins[`${c.node_type}-${c.node_id}`];
            return flow !== undefined ? t("warnings:scopeClampFromFlow", { item, flow }) : item;
          })}
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
