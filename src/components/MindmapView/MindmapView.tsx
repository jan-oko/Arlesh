import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "./use-mindmap-data";
import { useDismissableLoadCondition } from "./use-dismissable-load-condition";
import { useDrag } from "./use-drag";
import { useCanvasLayout } from "./use-canvas-layout";
import { useNodeTypeManager } from "./use-node-type-manager";
import { useNodeEditor } from "./use-node-editor";
import { useNodeActions } from "./use-node-actions";
import { useContextAction } from "./use-context-action";
import { useNavigateArrow } from "./use-navigate-arrow";
import { useKeyboardMindmap } from "./use-keyboard-mindmap";
import { useUndo } from "@/hooks/use-undo";
import { withGesture } from "@/api/gesture";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useClipboardStore, CLIPBOARD_OP } from "@/stores/use-clipboard-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { updateTask, reparentScopeConflicts } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { getErrorMessage } from "@/api/errors";
import { findNode, findParent, collectTasksAndGoals, collectSubtreePostOrder, computeShiftSelectRange, conversionNeedsConfirm, canConvertNodeToFlow, collectSearchableNodes } from "@/utils/mindmap-tree";
import MindmapCanvas, { type MindmapCanvasHandle } from "@/components/MindmapCanvas/MindmapCanvas";
import DragGhost from "@/components/DragGhost/DragGhost";
import DragPlaceholder from "@/components/DragPlaceholder/DragPlaceholder";
import { useFilterStore } from "@/stores/use-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useViewStore } from "@/stores/use-view-store";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { filterTreeWithFocus } from "@/utils/filter-tree";
import { collapsedWithFoldedRuns, foldHabitRuns, isHabitRunNode } from "@/utils/habit-collapse";
import { useHabitCollapseLabels } from "@/hooks/use-habit-collapse-labels";
import { useDisplayStore } from "@/stores/use-display-store";
import { focusExemptPath } from "@/utils/focus-exemption";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import HabitFailureBanner from "@/components/HabitFailureBanner/HabitFailureBanner";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import CommitmentEditorModal, { type CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import CommitmentScopePrompt from "@/components/CommitmentScopePrompt/CommitmentScopePrompt";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import InfoEditorModal from "@/components/InfoEditorModal/InfoEditorModal";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import FlowEditorModal, { type FlowSaveData, type TargetSelection } from "@/components/FlowEditorModal/FlowEditorModal";
import FlowItemEditorModal from "@/components/FlowItemEditorModal/FlowItemEditorModal";
import StartFlowModal, { type StartFlowData } from "@/components/StartFlowModal/StartFlowModal";
import { startFlow, convertToFlow } from "@/api/flows";
import ConvertToFlowModal from "@/components/ConvertToFlowModal/ConvertToFlowModal";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import styles from "./MindmapView.module.css";

/** Screen-px moved per arrow-key press when panning the canvas (nothing selected). */
const KEYBOARD_PAN_STEP = 80;

/**
 * A tree node as a Flow Target Node value. Used to show a flow's parent as its **inherited** target
 * — a flow with no explicit target renders its instances under its parent — so the editor and the
 * start modal both offer the node the instances would actually land on.
 */
function targetSelectionFor(node: MindmapNode | null | undefined): TargetSelection | null {
  if (node === null || node === undefined || node.id === "root") return null;
  const id = parseInt(node.id.split("-").pop() ?? "", 10);
  return Number.isNaN(id) ? null : { kind: node.kind, id, title: node.title };
}

// A pristine flow used to seed the create editor before the flow is persisted.
const BLANK_FLOW_NODE: MindmapNode = {
  id: "flow-new", kind: "flow", title: "", position: 0,
  flow: { instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: false, rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null, verdictWindowN: null, verdictWindowKind: null },
  tagIds: [], children: [],
};

// A pristine commitment used to seed the create editor before the commitment is persisted. It
// carries no Time Scope on purpose: an empty window field is the question Shift+C asks.
const BLANK_COMMITMENT_NODE: MindmapNode = {
  id: "commitment-new", kind: "commitment", title: "", position: 0, tagIds: [], children: [],
};

export default function MindmapView() {
  const { t } = useTranslation(["common", "editor", "warnings", "nodeKinds", "undo"]);
  const { tree, isLoading, error, loadCondition, createNode, createChild, renameNode, retypeNode, reorderNode, moveNode, duplicateNode, removeNode, createCommitment, createFlow, reload } =
    useMindmapData();
  const {
    selectedNodeId, selectedNodeIds, subtreeRootId, collapsedNodeIds, expandedRunIds, pendingToast,
    selectNode, addToSelection, setSelection, enterSubtree,
    toggleCollapsed, toggleRunExpanded, showToast, clearToast,
  } = useMindmapStore((s) => s);
  // App-wide, so a subtree cut in one tab pastes in another.
  const clipboard = useClipboardStore((s) => s.clipboard);
  const setClipboard = useClipboardStore((s) => s.setClipboard);

  // Shared with the List View: one subtree root, one set of back-nav pills, both views publishing
  // the same descriptor so whichever is on screen keeps the top bar right.
  const { onExitSubtree, onExitToRoot } = useSubtreeNav(tree);

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const { visibleFailedFlows, visibleUnrenderableCommitmentFlows, dismiss: dismissHabitBanner } =
    useDismissableLoadCondition(loadCondition);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [flowCreateParent, setFlowCreateParent] = useState<{ id: string; kind: NodeKind } | null>(null);
  const [commitmentCreateParent, setCommitmentCreateParent] = useState<{ id: string; kind: NodeKind } | null>(null);
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
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  // The focus exemption: whatever is selected stays on screen even once your own edit stops it
  // matching — completing a task under Plan no longer erases it out from under you. It ends when the
  // selection moves or the filter/subtree changes; see use-focus-exemption.
  const focusExemptNodeId = useFocusExemption(selectedNodeId, [filter, subtreeRootId]);
  const { root: filteredRoot, exemptedIds: focusExemptIds } = useMemo(() => {
    const base = subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree;
    return filterTreeWithFocus(base, filter, focusExemptPath(base, focusExemptNodeId));
  }, [subtreeRootId, tree, filter, focusExemptNodeId]);

  // Passed Habit iterations fold *after* the filter, never before it: a folded run is a way of
  // drawing iterations, not a node the filter could evaluate, so it stands for whichever of them
  // the filter kept — and therefore renders exactly when one of them would have.
  const habitCollapseThreshold = useDisplayStore((s) => s.habitCollapseThreshold);
  const collapseLabels = useHabitCollapseLabels();
  const displayRoot = useMemo(
    () => foldHabitRuns(filteredRoot, habitCollapseThreshold, collapseLabels),
    [filteredRoot, habitCollapseThreshold, collapseLabels],
  );
  // A run node is folded until the user opens it, which the collapsed set cannot say on its own.
  const collapsedWithRuns = useMemo(
    () => collapsedWithFoldedRuns(displayRoot, collapsedNodeIds, expandedRunIds),
    [displayRoot, collapsedNodeIds, expandedRunIds],
  );
  // Ctrl+/ on a folded run opens it; on anything else it collapses as it always has.
  const toggleCollapsedOrRun = useCallback(
    (id: string) => {
      const node = findNode(displayRoot, id);
      if (node !== undefined && isHabitRunNode(node)) toggleRunExpanded(id);
      else toggleCollapsed(id);
    },
    [displayRoot, toggleRunExpanded, toggleCollapsed],
  );

  const canvasRef = useRef<MindmapCanvasHandle>(null);

  // Entering a subtree recentres the canvas — but *arriving* in a tab must not, or switching to a
  // tab rooted somewhere else would throw away the pan and zoom that tab was holding. Only a change
  // of root within the same tab counts.
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const lastCentered = useRef<{ tabId: string; subtreeRootId: string | null } | null>(null);
  useEffect(() => {
    const previous = lastCentered.current;
    lastCentered.current = { tabId: activeTabId, subtreeRootId };
    if (previous === null || previous.tabId !== activeTabId) return;
    if (previous.subtreeRootId === subtreeRootId) return;
    if (subtreeRootId !== null) canvasRef.current?.centerOnRoot();
  }, [subtreeRootId, activeTabId]);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onGoalSave, onCommitmentSave, onSimpleSave, onProjectSave, onInfoSave, onFlowSave, onFlowItemSave,
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

  // The parent a flow's instances fall back to when it carries no explicit Target Node: the node
  // the editor shows as the inherited value, and the start modal pre-selects.
  const editedFlowParent = useMemo(
    () => (editorModal !== null && editorModal.node.kind === "flow" ? targetSelectionFor(findParent(tree, editorModal.node.id)) : null),
    [editorModal, tree],
  );
  const newFlowParent = useMemo(
    () => (flowCreateParent === null ? null : targetSelectionFor(findNode(tree, flowCreateParent.id))),
    [flowCreateParent, tree],
  );
  const startedFlowParent = useMemo(
    () => (startFlowNode === null ? null : targetSelectionFor(findParent(tree, startFlowNode.id))),
    [startFlowNode, tree],
  );

  // Opens a blank flow editor scoped to the chosen parent; the flow is persisted only on save.
  const onNewFlow = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setFlowCreateParent({ id: parentId, kind: parent.kind });
    },
    [tree],
  );

  // Opens a blank commitment editor scoped to the chosen parent; the commitment is persisted only
  // on save. Like a Flow, and for a sharper reason: a Commitment is not valid without a window, so
  // there is nothing to create first and configure afterwards.
  const onNewCommitment = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setCommitmentCreateParent({ id: parentId, kind: parent.kind });
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
          verdictWindowN: flow.verdict_window_n,
          verdictWindowKind: flow.verdict_window_kind,
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
        verdict_window_n: data.verdictWindowN,
        verdict_window_kind: data.verdictWindowKind,
      });
      setFlowCreateParent(null);
    },
    [flowCreateParent, createFlow],
  );

  // Persists a brand-new commitment under the pending parent, then closes the create editor. A
  // refusal — a commitment with no window of its own and none above it — is left to propagate, so
  // the editor shows it and stays open on the fields that would answer it.
  const onCreateCommitment = useCallback(
    async (data: CommitmentSaveData) => {
      if (commitmentCreateParent === null) return;
      await createCommitment(commitmentCreateParent.id, commitmentCreateParent.kind, data);
      setCommitmentCreateParent(null);
    },
    [commitmentCreateParent, createCommitment],
  );

  // Wraps moveNode so a drag reparent that would orphan scoped items prompts to clamp them first.
  // One Gesture around the whole thing: the clamps only exist because of the move, so undoing the
  // move without them would leave the scopes the drag rewrote sitting at their clamped values.
  const guardedMoveNode = useCallback(
    async (id: string, kind: NodeKind, parentId: string, parentKind: NodeKind, position: number) => {
      await withGesture(t("undo:gestures.move", { count: 1 }), async () => {
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
      });
    },
    [confirmScopeClamp, moveNode, t],
  );

  const { dragSourceId, dragTargetId, ghostPos, onDragStart } = useDrag({ tree, moveNode: guardedMoveNode });

  const { effectiveCollapsedIds, positions, subtreeLayout, placeholderPos } = useCanvasLayout({
    displayRoot, tree, collapsedNodeIds: collapsedWithRuns, dragSourceId, dragTargetId, orientation: mindmapOrientation,
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

  const {
    warningModal, setWarningModal, cycleType, setType, retypeActions,
    commitmentScopeRequest, resolveCommitmentScope,
  } = useNodeTypeManager({
    tree, retypeNode, selectNode, showToast,
  });

  const { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt } = useTaskBacklog({
    findNode: findNodeById, reload, showToast,
  });

  const { toggleAgentic } = useTaskAgentic({ findNode: findNodeById, reload, showToast });

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


  const { onStatusClick, onCommitEdit, onCreateChild, onCreateTypedChild, onCreateSibling, onInsertParent, onDelete, onPaste } = useNodeActions({
    tree, clipboard, moveNode, duplicateNode, onRequestDelete: setDeleteTargets, reload, renameNode,
    createNode, createChild, selectNode, setClipboard, setEditingNodeId, showToast, onNewFlow, onNewCommitment,
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
    setClipboard, clipboard, onPaste, toggleCollapsed: toggleCollapsedOrRun, onDelete, onNewFlow, onConvertToFlow, onStartFlow,
  });

  const handleCtrlClick = useCallback((id: string) => { addToSelection(id); }, [addToSelection]);

  const handleShiftClick = useCallback((id: string) => {
    if (selectedNodeId === null) { selectNode(id); return; }
    const range = computeShiftSelectRange(tree, selectedNodeId, id);
    if (range !== null) {
      setSelection(new Set(range), selectedNodeId);
    }
  }, [selectedNodeId, tree, selectNode, setSelection]);

  const { onUndo, onRedo } = useUndo({ reload, showToast });

  useKeyboardMindmap({
    isInputActive: isInputCaptured,
    // Both prompts swallow the canvas keys; Escape dismisses whichever is open.
    isWarningActive: warningModal !== null || planPrompt !== null,
    onDismissWarning: () => { setWarningModal(null); cancelPlanPrompt(); },
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
    onCreateTypedChild,
    onCreateSibling,
    onInsertParent,
    onOpenEditor: onDoubleClick,
    onStartFlow,
    onDelete,
    onToggleCollapsed: toggleCollapsedOrRun,
    onCycleStatus: onStatusClick,
    onDeselect: () => { selectNode(null); },
    onExitSubtree,
    onExitToRoot,
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
    onToggleFullscreen: toggleFullscreen,
    onExtendSelection: extendSelection,
    onToggleBacklog: toggleBacklog,
    onUndo,
    onRedo,
    onToggleAgentic: toggleAgentic,
    findNodeById,
  });
  const targetPos = dragTargetId !== null ? positions.get(dragTargetId) : undefined;

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
      {(visibleFailedFlows.length > 0 || visibleUnrenderableCommitmentFlows.length > 0) && (
        <HabitFailureBanner
          failedFlows={visibleFailedFlows}
          unrenderableCommitmentFlows={visibleUnrenderableCommitmentFlows}
          onDismiss={dismissHabitBanner}
        />
      )}
      <MindmapCanvas
        ref={canvasRef}
        root={displayRoot}
        orientation={mindmapOrientation}
        collapsedNodeIds={effectiveCollapsedIds}
        selectedNodeIds={selectedNodeIds}
        focusExemptIds={focusExemptIds}
        editingNodeId={editingNodeId}
        dragTargetId={dragTargetId}
        dragSourceId={dragSourceId}
        hasClipboard={clipboard !== null}
        canvasOverlay={placeholderPos !== null && targetPos !== undefined ? (
          <DragPlaceholder placeholderPos={placeholderPos} targetPos={targetPos} subtreeLayout={subtreeLayout} collapsedNodeIds={collapsedWithRuns} dragSourceId={dragSourceId} orientation={mindmapOrientation} tree={tree} />
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


      <AnchoredToast toast={pendingToast} onDismiss={clearToast} />

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal node={editorModal.node} allTags={allTags} domainNames={domainNames} availableForDep={availableForDep} onSave={onTaskSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "goal" && (
        <GoalEditorModal node={editorModal.node} allTags={allTags} domainNames={domainNames} onSave={onGoalSave} onCheckScopeClamp={checkScopeClamp} onClose={() => setEditorModal(null)} />
      )}
      {editorModal !== null && editorModal.node.kind === "commitment" && (
        <CommitmentEditorModal node={editorModal.node} allTags={allTags} domainNames={domainNames} onSave={onCommitmentSave} onClose={() => setEditorModal(null)} />
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
        <FlowEditorModal node={editorModal.node} availableTargets={flowTargets} inheritedTarget={editedFlowParent} onSave={onFlowSave} onClose={() => setEditorModal(null)} />
      )}
      {commitmentCreateParent !== null && (
        <CommitmentEditorModal node={BLANK_COMMITMENT_NODE} allTags={allTags} domainNames={domainNames} heading={t("editor:newCommitmentTitle")} onSave={onCreateCommitment} onClose={() => setCommitmentCreateParent(null)} />
      )}
      {flowCreateParent !== null && (
        <FlowEditorModal node={BLANK_FLOW_NODE} availableTargets={flowTargets} inheritedTarget={newFlowParent} heading={t("editor:newFlowTitle")} onSave={onCreateFlow} onClose={() => setFlowCreateParent(null)} />
      )}
      {/* With no explicit Target Node the start picker opens on the flow's parent — where a flow
          with a derived target puts its instances. */}
      {startFlowNode !== null && (
        <StartFlowModal
          flowTitle={startFlowNode.title}
          flowScoped={startFlowNode.flow?.durationKind != null}
          durationN={startFlowNode.flow?.durationN ?? null}
          durationKind={startFlowNode.flow?.durationKind ?? null}
          defaultTargetType={startFlowNode.flow?.targetType ?? startedFlowParent?.kind ?? null}
          defaultTargetId={startFlowNode.flow?.targetId ?? startedFlowParent?.id ?? null}
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

      {planPrompt !== null && (
        <BacklogConfirmModal prompt={planPrompt} onConfirm={confirmClearPlan} onCancel={cancelPlanPrompt} />
      )}

      {commitmentScopeRequest !== null && (
        <CommitmentScopePrompt
          title={commitmentScopeRequest.title}
          onResolve={resolveCommitmentScope}
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
