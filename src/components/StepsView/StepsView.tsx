import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useNodeActions } from "@/components/MindmapView/use-node-actions";
import { useCreateEditors } from "@/hooks/use-create-editors";
import { useListDelete } from "@/hooks/use-list-delete";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import { useFoldReading } from "@/hooks/use-fold-reading";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useStatusCycle } from "@/hooks/use-status-cycle";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import { useTaskAsynchronous } from "@/hooks/use-task-asynchronous";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useUndo } from "@/hooks/use-undo";
import { useClipboardStore } from "@/stores/use-clipboard-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { getErrorMessage } from "@/api/errors";
import { drawnPathToNode } from "@/utils/drawn-path";
import { foldHabitRuns, habitGroupFlowId, isHabitGroupNode } from "@/utils/habit-collapse";
import { collectSearchableNodes, collectTasksAndGoals, findNode } from "@/utils/mindmap-tree";
import { aspectColorOf } from "@/utils/node-visuals";
import { canDescendInto, creatableKinds, stepChildCounts, stepRefusalKey } from "@/utils/steps-card";
import type { StepChildCounts } from "@/utils/steps-card";
import { canParentAnyNewChild, hasNodeEditor } from "@/utils/node-meta";
import type { TypedChildKind } from "@/utils/node-meta";
import { neighbourAfterDelete } from "@/utils/neighbour-after-delete";
import {
  CARD_GAP, HEADER_CURSOR, STEPS_ZOOM_LEVELS, cardSizeForZoom, childCursor, clampPage, moveAcrossPages,
  pageCount, pageSlice, resolveGrid, shownPage,
} from "@/utils/steps-grid";
import type { StepCursor, StepDirection, StepsZoom } from "@/utils/steps-grid";
import type { StepsTarget } from "@/utils/hotkeys/steps-bindings";
import type { MindmapNode } from "@/utils/tree-layout";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import NodeCreateModals from "@/components/NodeCreateModals/NodeCreateModals";
import NodeEditorModals from "@/components/NodeEditorModals/NodeEditorModals";
import { useOpenAsyncTemplate } from "@/hooks/use-open-async-template";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import UnfinishedChildrenModal from "@/components/UnfinishedChildrenModal/UnfinishedChildrenModal";
import StepCard from "./StepCard";
import StepCreateMenu from "./StepCreateMenu";
import { useKeyboardStepsView } from "./use-keyboard-steps-view";
import { useStepGrid } from "./use-step-grid";
import styles from "./StepsView.module.css";

/**
 * What the Steps View has picked, held as **the card's node id** rather than its place in the grid.
 *
 * A Step is filtered and paginated, so an index names a different card the moment either changes —
 * completing a Task under Plan would silently move the cursor onto its neighbour. An id also keeps
 * the focus exemption non-circular: the exemption needs to know what is selected *before* the
 * filter runs, and the raw selection is the one thing that does not depend on the filter's output.
 */
type StepSelection = { cell: "header" } | { cell: "child"; nodeId: string } | null;

/** The zoom one level along from `zoom`, or `zoom` itself at either end of the range. */
function steppedZoom(zoom: StepsZoom, direction: 1 | -1): StepsZoom {
  const index = STEPS_ZOOM_LEVELS.indexOf(zoom) + direction;
  return STEPS_ZOOM_LEVELS[index] ?? zoom;
}

/**
 * The **Steps View**: one Step at a time — the node you are standing on, and what is directly
 * inside it.
 *
 * Neither of the other views does this. The Mindmap draws the whole reachable tree, which is its
 * strength when you are placing work in context and a wall when you are not; the List View
 * flattens to Tasks, so you cannot walk the board through it at all. Here the node you are on is a
 * **header card**, its direct children are cards beneath it, and nothing deeper is drawn.
 *
 * **Descending moves the tab's shared subtree root** — the same one `Ctrl+O` and the breadcrumb
 * move. That is what makes this a reading of one board rather than a fourth board: switching to the
 * Mindmap afterwards lands on the node you walked to, the breadcrumb names the Step, and the ways
 * back out (`Shift+Escape`, `Ctrl+Escape`, a breadcrumb click) are the ones that already exist.
 * There is deliberately **no Steps-specific exit gesture**.
 *
 * The **selection is its own**, as the Mindmap's and the List View's are: what the views share is
 * where the tab is rooted, not what is picked inside it.
 *
 * Passed Habit iterations **fold** here as they do on the Mindmap — by the Mindmap's own
 * `foldHabitRuns`, after the filter, at the one shared threshold — into a card titled with the
 * Habit and its tally. `Enter` descends into it: the Step inside a run is its next scope level,
 * each level a card of the same kind, down to the iterations. A fold node is drawn rather than
 * stored, so a Step standing on one resolves it by its id (`drawn-path.ts`): the id names the
 * Habit, the Habit names the host to fold again, and folding is deterministic. That is what lets a
 * tab rooted in a run survive a reload rather than being bounced to the true root.
 */
export default function StepsView() {
  const { t } = useTranslation(["common", "stepsView", "warnings"]);
  const {
    tree, isLoading, error, reload, createChild, createNode, renameNode, moveNode, duplicateNode, removeNode,
    createCommitment, createFlow,
  } = useMindmapData();
  const clipboard = useClipboardStore((s) => s.clipboard);
  const setClipboard = useClipboardStore((s) => s.setClipboard);

  const filter = useBoardFilter();
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const zoom = useViewStore((s) => s.stepsZoom);
  const setZoom = useViewStore((s) => s.setStepsZoom);

  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  const searchOpen = useMindmapStore((s) => s.searchOpen);
  const closeSearch = useMindmapStore((s) => s.closeSearch);
  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const isInputCaptured = useIsInputCaptured();

  // Publishes the tab's subtree descriptor for the top bar; the exits are global bindings.
  const { subtreeRootId } = useSubtreeNav(tree);

  const [selection, setSelection] = useState<StepSelection>(null);
  const [page, setPage] = useState(0);
  // The card whose title is open for naming — one just created, as on the other views.
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The card a creation gesture is making a child *of*, when that card is not the Step itself: the
  // new node is inside it, so it is shown by stepping in. Set as the gesture starts and read once,
  // by the selection the shared action makes on success — a refusal never selects, so never steps.
  const descendOnCreate = useRef<string | null>(null);

  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);
  const nodeEditor = useNodeEditor({ tree, allTasksAndGoals, reload });
  const { editorModal, setEditorModal } = nodeEditor;

  // The focus exemption: the selected card stays on the Step even once your own edit stops it
  // matching — cycling a Task to Done under Plan no longer erases it out from under the cursor. It
  // ends when the selection moves or the filter or the subtree changes.
  const selectedChildId = selection !== null && selection.cell === "child" ? selection.nodeId : null;
  const focusExemptNodeId = useFocusExemption(selectedChildId, [filter, subtreeRootId]);
  // How a host is drawn before its Habit history folds: the tab's filter, with this exemption.
  const reading = useFoldReading(focusExemptNodeId);

  // The node the Step is standing on. A stored node is read from the **unfiltered** tree: it is
  // what you walked to, so the filter never takes it out from under you. A folded run of Habit
  // history, or a scope level of one, exists only drawn, so it is the drawn one — filtered and
  // folded already. `null` is the true root, where the header card stands for the board itself.
  const rawStepNode = useMemo(() => {
    if (subtreeRootId === null) return null;
    if (habitGroupFlowId(subtreeRootId) === undefined) return findNode(tree, subtreeRootId) ?? null;
    const path = drawnPathToNode(tree, subtreeRootId, reading);
    return path[path.length - 1] ?? null;
  }, [tree, subtreeRootId, reading]);
  const standsOnFold = rawStepNode !== null && isHabitGroupNode(rawStepNode);

  // The Step before its Habit history folds — what the "3 of 12" counts are read from, since a
  // count of cards would read a fold as the filter hiding what it only gathered up.
  const unfoldedRoot = useMemo(
    () => (standsOnFold && rawStepNode !== null ? rawStepNode : reading.drawHost(rawStepNode ?? tree)),
    [standsOnFold, rawStepNode, tree, reading],
  );
  // And after: runs of passed iterations at or over the threshold are one card each. Folding is
  // idempotent, so a Step that is itself a fold node comes through unchanged.
  const filteredRoot = useMemo(
    () => foldHabitRuns(unfoldedRoot, reading.threshold, reading.labels),
    [unfoldedRoot, reading],
  );

  /** A node on this Step or anywhere on the board — a fold card is only on the Step. */
  function lookup(id: string): MindmapNode | undefined {
    return findNode(tree, id) ?? findNode(filteredRoot, id);
  }

  /**
   * What a card counts: what descending shows against what the board holds. A fold card counts
   * nothing — its title is already the tally of what it stands for.
   */
  function cardCounts(node: MindmapNode): StepChildCounts | null {
    if (isHabitGroupNode(node)) return null;
    return stepChildCounts(findNode(unfoldedRoot, node.id) ?? node, findNode(tree, node.id));
  }

  const children = filteredRoot.children;
  const { ref: childAreaRef, grid: measuredGrid } = useStepGrid(zoom);
  const grid = resolveGrid(measuredGrid, children.length);
  const pages = pageCount(children.length, grid.pageSize);
  const selectedChildIndex = selectedChildId === null ? -1 : children.findIndex((child) => child.id === selectedChildId);
  const currentPage = shownPage(page, selectedChildIndex, children.length, grid.pageSize);
  const pageChildren = pageSlice(children, currentPage, grid.pageSize);

  // The cursor is **derived**, not stored: a selected card the filter has since dropped, or one
  // that moved to another page, simply reads as no selection rather than as a stale highlight.
  function currentCursor(): StepCursor | null {
    if (selection === null) return null;
    if (selection.cell === "header") return HEADER_CURSOR;
    const index = pageChildren.findIndex((child) => child.id === selection.nodeId);
    return index === -1 ? null : childCursor(index);
  }
  const cursor = currentCursor();

  function cursorNode(): MindmapNode | null {
    if (cursor === null) return null;
    if (cursor.cell === "header") return rawStepNode;
    return pageChildren[cursor.index] ?? null;
  }
  const selectedNode = cursorNode();

  const { cycleStatus, occurrencePrompt, confirmOccurrence, cancelOccurrence } = useStatusCycle({
    findNode: (id) => findNode(tree, id), reload, showToast,
  });
  const { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt } = useTaskBacklog({
    findNode: (id) => findNode(tree, id), reload, showToast,
  });
  const { toggleAgentic } = useTaskAgentic({ findNode: (id) => findNode(tree, id), reload, showToast });
  const { toggleAsynchronous } = useTaskAsynchronous({
    findNode: (id) => findNode(tree, id), reload, showToast,
  });
  const openAsyncTemplate = useOpenAsyncTemplate(tree, setEditorModal);
  const { onUndo, onRedo } = useUndo({ reload, showToast });

  /**
   * Selects a card a shared action just created. When the gesture made a child of a card rather
   * than of the Step, the new node is one level down, so this steps into that card first — the
   * same place `Enter` on it would take you.
   */
  const selectCreated = useCallback((id: string | null) => {
    const into = descendOnCreate.current;
    descendOnCreate.current = null;
    if (into !== null) { enterSubtree(into); setPage(0); }
    setSelection(id === null ? null : { cell: "child", nodeId: id });
  }, [enterSubtree]);

  const createEditors = useCreateEditors({ tree, createFlow, createCommitment });

  // Deleting on the other views' terms: the List View's single-selection confirmation and its
  // "next, else previous" landing, over the Mindmap's writer — so one Ctrl+Z takes it back.
  const { pendingDelete, isDeleting, error: deleteError, requestDelete, confirmDelete, cancelDelete } =
    useListDelete({
      findNode: (id) => findNode(tree, id),
      removeNode,
      neighbourAfterDelete: (id, deletedIds) => neighbourAfterDelete(children.map((child) => child.id), id, deletedIds),
      selectRow: (id) => setSelection(id === null ? null : { cell: "child", nodeId: id }),
      showToast,
    });

  // The Mindmap's creation and deletion actions, whole: the type rules, the parent rules, the
  // refusals and the undo Gestures all come with them.
  const actions = useNodeActions({
    tree, clipboard, moveNode, duplicateNode, reload, renameNode, createNode, createChild, setClipboard,
    showToast, setEditingNodeId,
    onRequestDelete: (ids) => { const first = ids[0]; if (first !== undefined) requestDelete(first); },
    selectNode: selectCreated,
    onNewFlow: createEditors.onNewFlow,
    onNewCommitment: createEditors.onNewCommitment,
  });

  const stepNodeId = rawStepNode?.id ?? null;

  /**
   * Refuses, out loud, a gesture aimed at a **fold card** — a folded run of Habit history or one of
   * its scope levels. It is a drawing of many iterations: there is nothing inside it to create in,
   * and nothing of its own to mark, move or delete. Descending is the one thing it answers.
   * Returns whether it refused.
   */
  function refusedOnDrawing(id: string, key: "refusedCreateInDrawing" | "refusedActOnDrawing"): boolean {
    const node = lookup(id);
    if (node === undefined || !isHabitGroupNode(node)) return false;
    showToast({ nodeId: id, message: t(`stepsView:${key}`, { title: node.title }) });
    return true;
  }

  /** `act`, unless `id` is a fold card, which refuses it. */
  function unlessDrawing(act: (id: string) => void): (id: string) => void {
    return (id) => { if (!refusedOnDrawing(id, "refusedActOnDrawing")) act(id); };
  }

  /** Refuses a gesture that would act on the Step you are standing on from inside it. */
  function refuseOnStep(id: string, key: "refusedSiblingOfStep" | "refusedParentOfStep" | "refusedDeleteStep"): void {
    const node = findNode(tree, id);
    showToast({ nodeId: id, message: t(`stepsView:${key}`, { title: node?.title ?? "" }) });
  }

  function onCreateChildHere(id: string): void {
    if (refusedOnDrawing(id, "refusedCreateInDrawing")) return;
    descendOnCreate.current = id === stepNodeId ? null : id;
    actions.onCreateChild(id);
  }

  function onCreateTypedChildHere(id: string, kind: TypedChildKind): void {
    if (refusedOnDrawing(id, "refusedCreateInDrawing")) return;
    descendOnCreate.current = id === stepNodeId ? null : id;
    actions.onCreateTypedChild(id, kind);
  }

  /** A kind created on the Step itself — a typed chord with nothing selected, or the "+" menu. */
  function onCreateTypedChildOnStep(kind: TypedChildKind): void {
    if (stepNodeId === null) { refuseAtBoardRoot(); return; }
    onCreateTypedChildHere(stepNodeId, kind);
  }

  // A sibling of the Step, or a parent inserted above it, would land outside the Step you are
  // looking at — so on the header card both are refused, and said. On a card they land here.
  function onCreateSiblingHere(id: string): void {
    descendOnCreate.current = null;
    if (id === stepNodeId) { refuseOnStep(id, "refusedSiblingOfStep"); return; }
    if (refusedOnDrawing(id, "refusedActOnDrawing")) return;
    actions.onCreateSibling(id);
  }

  function onInsertParentHere(id: string): void {
    descendOnCreate.current = null;
    if (id === stepNodeId) { refuseOnStep(id, "refusedParentOfStep"); return; }
    if (refusedOnDrawing(id, "refusedActOnDrawing")) return;
    actions.onInsertParent(id);
  }

  function onDeleteHere(id: string): void {
    if (id === stepNodeId) { refuseOnStep(id, "refusedDeleteStep"); return; }
    if (refusedOnDrawing(id, "refusedActOnDrawing")) return;
    actions.onDelete([id]);
  }

  /** Puts the selection on a cell of the current page, by id. */
  function selectCursor(next: StepCursor, from: readonly MindmapNode[]): void {
    if (next.cell === "header") { setSelection({ cell: "header" }); return; }
    const node = from[next.index];
    if (node !== undefined) setSelection({ cell: "child", nodeId: node.id });
  }

  /**
   * Descending. A card that cannot be entered **says so** rather than doing nothing — a gesture
   * that cannot act has to be audible (Arlesh-zlg), and "nothing happened" is the one response
   * that teaches the user nothing about why.
   */
  const onDescend = useCallback(
    (id: string) => {
      const node = findNode(tree, id) ?? findNode(filteredRoot, id);
      if (node === undefined) return;
      if (id === subtreeRootId) {
        showToast({ nodeId: id, message: t("stepsView:refusedAlreadyHere", { title: node.title }) });
        return;
      }
      if (!canDescendInto(node)) {
        showToast({ nodeId: id, message: t(`stepsView:${stepRefusalKey(node)}`, { title: node.title }) });
        return;
      }
      enterSubtree(id);
      setSelection(null);
      setPage(0);
    },
    [tree, filteredRoot, subtreeRootId, enterSubtree, showToast, t],
  );

  // An arrow that runs off the end of a page carries on onto the next page's adjacent card; the
  // page shown follows the selection there.
  function onNavigate(direction: StepDirection): void {
    const next = moveAcrossPages(cursor, direction, currentPage, children.length, grid);
    if (next.page !== currentPage) setPage(next.page);
    selectCursor(next.cursor, pageSlice(children, next.page, grid.pageSize));
  }

  // Turning a page moves the cursor onto the first card of the page you turned to, rather than
  // leaving it on a card that is no longer drawn.
  function onStepPage(direction: 1 | -1): void {
    const next = clampPage(currentPage + direction, children.length, grid.pageSize);
    if (next === currentPage) return;
    setPage(next);
    const landing = pageSlice(children, next, grid.pageSize)[0];
    setSelection(landing === undefined ? null : { cell: "child", nodeId: landing.id });
  }

  const onStepZoom = useCallback(
    (direction: 1 | -1) => { setZoom(steppedZoom(zoom, direction)); },
    [zoom, setZoom],
  );

  /**
   * Opening the editor. A kind that has none is **refused out loud** rather than setting the modal
   * open on nothing: `NodeEditorModals` would render null, the keyboard would stay captured behind
   * a modal that was never drawn, and every Steps binding would go dead with no way back.
   */
  const onOpenEditor = useCallback(
    (id: string) => {
      const node = findNode(tree, id) ?? findNode(filteredRoot, id);
      if (node === undefined) return;
      if (!hasNodeEditor(node)) {
        showToast({ nodeId: id, message: t("stepsView:refusedNoEditor", { title: node.title }) });
        return;
      }
      // Every row opens its own kind's editor — a derived one included (ADR 0008): a check task
      // the Task editor, a spawned or delegation wait the Expectation editor.
      setEditorModal({ nodeId: node.id, node });
    },
    [tree, filteredRoot, setEditorModal, showToast, t],
  );

  /** The empty Step's offer: a first child, taken straight into its editor to be named. */
  const onCreateFirstChild = useCallback(() => {
    if (rawStepNode === null) return;
    void createChild(rawStepNode.id, rawStepNode.kind, "")
      .then((created) => setEditorModal({ nodeId: created.id, node: created }))
      .catch((err: unknown) => showToast({
        nodeId: rawStepNode.id,
        message: t("stepsView:createFailed", { title: rawStepNode.title, message: getErrorMessage(err) }),
      }));
  }, [rawStepNode, createChild, setEditorModal, showToast, t]);

  /** The board's own header card answers no gesture, and says so rather than doing nothing. */
  const refuseAtBoardRoot = useCallback(() => {
    showToast({ nodeId: "root", message: t("stepsView:refusedBoardRoot") });
  }, [showToast, t]);

  /** What the bindings act on: nothing, the board itself, or one node. */
  function keyboardTarget(): StepsTarget {
    if (cursor === null) return { kind: "none" };
    return selectedNode === null ? { kind: "board" } : { kind: "node", id: selectedNode.id };
  }

  useKeyboardStepsView({
    isInputActive: isInputCaptured || editorModal !== null || planPrompt !== null || occurrencePrompt !== null
      || pendingDelete !== null
      || createEditors.flowParent !== null || createEditors.commitmentParent !== null,
    target: keyboardTarget(),
    onRefuseBoard: refuseAtBoardRoot,
    onNavigate,
    onDescend,
    onStepPage,
    onStepZoom,
    onCycleStatus: unlessDrawing(cycleStatus),
    onToggleBacklog: unlessDrawing(toggleBacklog),
    onToggleAgentic: unlessDrawing(toggleAgentic),
    onToggleAsynchronous: unlessDrawing(toggleAsynchronous),
    onBindWait: unlessDrawing(openAsyncTemplate),
    onOpenEditor,
    onCreateChild: onCreateChildHere,
    onCreateTypedChild: onCreateTypedChildHere,
    onCreateTypedChildOnStep,
    onCreateSibling: onCreateSiblingHere,
    onInsertParent: onInsertParentHere,
    onDelete: onDeleteHere,
    onDeselect: () => setSelection(null),
    onToggleFullscreen: toggleFullscreen,
    onSetStatusMode: setStatusMode,
    onUndo,
    onRedo,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  const card = cardSizeForZoom(zoom);
  // The aspect this Step sits under, which every card on it is coloured from. One walk for the
  // whole Step: a Step is one place on the board, so its cards share an aspect — except at the true
  // root, where each top-level card *is* an aspect and carries its own colour.
  const stepAspectColor = rawStepNode === null ? undefined : aspectColorOf(tree, rawStepNode.id);
  const gridStyle: CSSProperties & Record<`--${string}`, string | number> = {
    "--step-card-width": `${card.width}px`,
    "--step-card-height": `${card.height}px`,
    "--step-card-gap": `${CARD_GAP}px`,
    "--step-columns": grid.columns,
  };
  const headerCounts = rawStepNode === null ? stepChildCounts(unfoldedRoot, tree) : cardCounts(rawStepNode);
  const stepTitle = rawStepNode?.title ?? t("stepsView:boardTitle");
  const holdsNothing = headerCounts !== null && headerCounts.total === 0;
  const canCreateFirstChild = rawStepNode !== null && holdsNothing && canParentAnyNewChild(rawStepNode);
  const stepCreatableKinds = rawStepNode === null ? [] : creatableKinds(rawStepNode);

  return (
    <div className={styles.container} style={gridStyle}>
      <AnchoredToast toast={pendingToast} onDismiss={clearToast} />

      {/* The header card takes the *filtered* copy of the node it stands for. The node itself is
          whatever you walked to and the filter never takes that away — but its children are what
          the Info bullets are drawn from, and those must honour the filter exactly as the child
          cards below it do. */}
      {/* The header card, and beside it the Step's "+": outside the card, because a card clips
          what overflows it and the menu has to drop below. No "+" on the board, where nothing can
          be created — the Aspects are fixed. */}
      <div className={styles.headerRow}>
        <StepCard
          node={rawStepNode === null ? null : filteredRoot}
          aspectColor={stepAspectColor}
          cardHeight={card.height}
          isHeader
          isSelected={cursor?.cell === "header"}
          counts={headerCounts}
          onSelect={() => setSelection({ cell: "header" })}
          // You are already standing here, so there is nothing below this card to descend into; the
          // gesture belongs to the cards under it.
          onDescend={refuseAtBoardRoot}
          onOpenEditor={() => (rawStepNode === null ? refuseAtBoardRoot() : onOpenEditor(rawStepNode.id))}
          isEditingTitle={rawStepNode !== null && editingNodeId === rawStepNode.id}
          onCommitTitle={(title) => { if (rawStepNode !== null) actions.onCommitEdit(rawStepNode.id, title); }}
          onCancelTitleEdit={() => setEditingNodeId(null)}
        />
        {/* Nor on a fold, which holds nothing that could be created. */}
        {stepCreatableKinds.length > 0 && (
          <StepCreateMenu kinds={stepCreatableKinds} onCreate={onCreateTypedChildOnStep} />
        )}
      </div>

      {children.length === 0 ? (
        <div className={styles.empty} ref={childAreaRef}>
          <p>
            {holdsNothing
              ? t("stepsView:emptyStep", { title: stepTitle })
              : t("stepsView:emptyStepFiltered", { title: stepTitle })}
          </p>
          {canCreateFirstChild && (
            <button type="button" className={styles.createBtn} onClick={onCreateFirstChild}>
              {t("stepsView:createFirstChild")}
            </button>
          )}
        </div>
      ) : (
        <div
          className={styles.children}
          ref={childAreaRef}
          role="group"
          aria-label={t("stepsView:childrenLabel")}
        >
          {pageChildren.map((child, index) => (
            <StepCard
              key={child.id}
              node={child}
              aspectColor={child.color ?? stepAspectColor}
              cardHeight={card.height}
              isHeader={false}
              isSelected={cursor?.cell === "child" && cursor.index === index}
              counts={cardCounts(child)}
              onSelect={() => setSelection({ cell: "child", nodeId: child.id })}
              onDescend={() => onDescend(child.id)}
              onOpenEditor={() => onOpenEditor(child.id)}
              isEditingTitle={editingNodeId === child.id}
              onCommitTitle={(title) => actions.onCommitEdit(child.id, title)}
              onCancelTitleEdit={() => setEditingNodeId(null)}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={currentPage === 0}
            aria-label={t("stepsView:previousPage")}
            onClick={() => onStepPage(-1)}
          >
            {"‹"}
          </button>
          <span>{t("stepsView:pageLabel", { page: currentPage + 1, pages })}</span>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={currentPage === pages - 1}
            aria-label={t("stepsView:nextPage")}
            onClick={() => onStepPage(1)}
          >
            {"›"}
          </button>
        </div>
      )}

      {searchOpen && (
        <NodeSearchModal
          nodes={collectSearchableNodes(tree)}
          onSelect={(id) => { enterSubtree(id); closeSearch(); setSelection(null); setPage(0); }}
          onClose={closeSearch}
        />
      )}

      <NodeEditorModals tree={tree} editor={nodeEditor} />
      <NodeCreateModals
        tree={tree} editors={createEditors} allTags={nodeEditor.allTags} domainNames={nodeEditor.domainNames}
      />

      {pendingDelete !== null && (
        <DeleteConfirmModal
          nodeTitle={pendingDelete.node.title}
          nodeCount={1}
          descendantCount={pendingDelete.descendantCount}
          isDeleting={isDeleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}

      {occurrencePrompt !== null && (
        <UnfinishedChildrenModal
          prompt={occurrencePrompt}
          onConfirm={confirmOccurrence}
          onCancel={cancelOccurrence}
        />
      )}

      {planPrompt !== null && (
        <BacklogConfirmModal prompt={planPrompt} onConfirm={confirmClearPlan} onCancel={cancelPlanPrompt} />
      )}
    </div>
  );
}
