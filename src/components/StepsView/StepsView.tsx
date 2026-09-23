import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useNodeActions } from "@/components/MindmapView/use-node-actions";
import { useCreateEditors } from "@/hooks/use-create-editors";
import { useListDelete } from "@/hooks/use-list-delete";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useStatusCycle } from "@/hooks/use-status-cycle";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import { useTaskAsynchronous } from "@/hooks/use-task-asynchronous";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useUndo } from "@/hooks/use-undo";
import { useClipboardStore } from "@/stores/use-clipboard-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { getErrorMessage } from "@/api/errors";
import { filterTreeWithFocus } from "@/utils/filter-tree";
import { focusExemptPath } from "@/utils/focus-exemption";
import { collectSearchableNodes, collectTasksAndGoals, findNode } from "@/utils/mindmap-tree";
import { aspectColorOf } from "@/utils/node-visuals";
import { canDescendInto, creatableKinds, stepChildCounts, stepRefusalKey } from "@/utils/steps-card";
import { hasNodeEditor } from "@/utils/node-meta";
import type { TypedChildKind } from "@/utils/node-meta";
import { neighbourAfterDelete } from "@/utils/neighbour-after-delete";
import {
  CARD_GAP, HEADER_CURSOR, STEPS_ZOOM_LEVELS, cardSizeForZoom, childCursor, clampPage, moveCursor,
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
 * Passed Habit iterations are **not folded** here, unlike on the Mindmap. Folding exists because
 * the Mindmap draws a whole subtree at once; a Step draws one level and paginates, which solves the
 * same problem without inventing a node. It also could not work: a folded run is drawn rather than
 * stored, so descending into one would set the tab's root to an id `pathToNode` cannot find, and
 * the recovery in `use-subtree-nav` would bounce you straight back to the true root.
 */
export default function StepsView() {
  const { t } = useTranslation(["common", "stepsView"]);
  const {
    tree, isLoading, error, reload, createChild, createNode, renameNode, moveNode, duplicateNode, removeNode,
    createCommitment, createFlow,
  } = useMindmapData();
  const clipboard = useClipboardStore((s) => s.clipboard);
  const setClipboard = useClipboardStore((s) => s.setClipboard);

  const filter = useFilterStore((s) => s.filter);
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

  // The node the Step is standing on, read from the **unfiltered** tree: it is what you walked to,
  // so the filter never takes it out from under you. `null` is the true root, where the header card
  // stands for the board itself.
  const rawStepNode = useMemo(
    () => (subtreeRootId === null ? null : findNode(tree, subtreeRootId) ?? null),
    [tree, subtreeRootId],
  );

  // The focus exemption: the selected card stays on the Step even once your own edit stops it
  // matching — cycling a Task to Done under Plan no longer erases it out from under the cursor. It
  // ends when the selection moves or the filter or the subtree changes.
  const selectedChildId = selection !== null && selection.cell === "child" ? selection.nodeId : null;
  const focusExemptNodeId = useFocusExemption(selectedChildId, [filter, subtreeRootId]);

  const { root: filteredRoot } = useMemo(() => {
    const base = rawStepNode ?? tree;
    return filterTreeWithFocus(base, filter, focusExemptPath(base, focusExemptNodeId));
  }, [rawStepNode, tree, filter, focusExemptNodeId]);

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

  /** Refuses a gesture that would act on the Step you are standing on from inside it. */
  function refuseOnStep(id: string, key: "refusedSiblingOfStep" | "refusedParentOfStep" | "refusedDeleteStep"): void {
    const node = findNode(tree, id);
    showToast({ nodeId: id, message: t(`stepsView:${key}`, { title: node?.title ?? "" }) });
  }

  function onCreateChildHere(id: string): void {
    descendOnCreate.current = id === stepNodeId ? null : id;
    actions.onCreateChild(id);
  }

  function onCreateTypedChildHere(id: string, kind: TypedChildKind): void {
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
    actions.onCreateSibling(id);
  }

  function onInsertParentHere(id: string): void {
    descendOnCreate.current = null;
    if (id === stepNodeId) { refuseOnStep(id, "refusedParentOfStep"); return; }
    actions.onInsertParent(id);
  }

  function onDeleteHere(id: string): void {
    if (id === stepNodeId) { refuseOnStep(id, "refusedDeleteStep"); return; }
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
      const node = findNode(tree, id);
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
    [tree, subtreeRootId, enterSubtree, showToast, t],
  );

  function onNavigate(direction: StepDirection): void {
    selectCursor(moveCursor(cursor, direction, pageChildren.length, grid.columns), pageChildren);
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
      const node = findNode(tree, id);
      if (node === undefined) return;
      if (!hasNodeEditor(node)) {
        showToast({ nodeId: id, message: t("stepsView:refusedNoEditor", { title: node.title }) });
        return;
      }
      setEditorModal({ nodeId: id, node });
    },
    [tree, setEditorModal, showToast, t],
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
    onCycleStatus: cycleStatus,
    onToggleBacklog: toggleBacklog,
    onToggleAgentic: toggleAgentic,
    onToggleAsynchronous: toggleAsynchronous,
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
  const headerCounts = stepChildCounts(filteredRoot, rawStepNode ?? tree);
  const stepTitle = rawStepNode?.title ?? t("stepsView:boardTitle");
  const canCreateFirstChild = rawStepNode !== null && headerCounts.total === 0 && canDescendInto(rawStepNode);

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
        {rawStepNode !== null && (
          <StepCreateMenu kinds={creatableKinds(rawStepNode)} onCreate={onCreateTypedChildOnStep} />
        )}
      </div>

      {children.length === 0 ? (
        <div className={styles.empty} ref={childAreaRef}>
          <p>
            {headerCounts.total === 0
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
              counts={stepChildCounts(child, findNode(tree, child.id))}
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
