import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import { useTaskAsynchronous } from "@/hooks/use-task-asynchronous";
import { useTaskCompound } from "@/hooks/use-task-compound";
import { useCommitmentVerdict } from "@/hooks/use-commitment-verdict";
import { useQuickPlan } from "@/hooks/use-quick-plan";
import { useQuickDependency } from "@/hooks/use-quick-dependency";
import { useOpenAsyncTemplate } from "@/hooks/use-open-async-template";
import { useListCreate } from "@/hooks/use-list-create";
import { useListDelete } from "@/hooks/use-list-delete";
import { useListScroll } from "@/hooks/use-list-scroll";
import { useUndo } from "@/hooks/use-undo";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useSearchableNodes } from "@/hooks/use-searchable-nodes";
import { useZenGrid } from "@/hooks/use-zen-grid";
import { useKeyboardZenView } from "@/hooks/use-keyboard-zen-view";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { findNode } from "@/utils/mindmap-tree";
import { neighbourAfterDelete } from "@/utils/neighbour-after-delete";
import { commitmentGlyphState } from "@/utils/commitment-glyph";
import { zenContents } from "@/utils/zen-contents";
import type { ZenDirection, ZenNavigationModel } from "@/utils/zen-grid";
import { zenCardShowsBadges, zenDrawnOrder, zenNavigationTarget, zenTextSize, ZEN_GAP_PX } from "@/utils/zen-grid";
import type { ListEdge } from "@/utils/hotkeys/list-bindings";
import CommitmentIcon from "@/components/NodeIcon/CommitmentIcon";
import ExpectationIcon from "@/components/NodeIcon/ExpectationIcon";
import NodeEditorModals from "@/components/NodeEditorModals/NodeEditorModals";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import QuickPlanPicker from "@/components/QuickPlanPicker/QuickPlanPicker";
import QuickDependencyPicker from "@/components/QuickDependencyPicker/QuickDependencyPicker";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import UnfinishedChildrenModal from "@/components/UnfinishedChildrenModal/UnfinishedChildrenModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import ZenStrip from "./ZenStrip";
import ZenTaskCard from "./ZenTaskCard";
import styles from "./ZenView.module.css";

/** Where the toast saying the preset cannot change is anchored — no card, the view as a whole. */
const PRESET_TOAST_ANCHOR = "zenView:preset";

/**
 * The **Zen View**: what is in progress, and nothing else — the List View's Task rows under **Do**,
 * as a grid of cards sized to fill the window, with the unresolved Commitments and the open
 * Expectations as two thin strips above it. See `docs/spec/zen-view.md`.
 *
 * It reads the same loaded tree and rows as the List View (`useListData`), takes the List View's key
 * bindings minus every create key (`ZEN_BINDINGS`), and drives them with the same shared action
 * hooks, on a selection of its own.
 */
export default function ZenView() {
  const { t } = useTranslation(["common", "zenView"]);
  const {
    tree, rows, commitmentRows, expectationRows, toggleRelease, allTasksAndGoals, isLoading, error, reload,
    onCycleStatus, onToggleStarted, renameNode, createTask, deleteTask, removeNode, occurrencePrompt, confirmOccurrence, cancelOccurrence,
  } = useListData();
  const sharedFilter = useBoardFilter();
  const isInputCaptured = useIsInputCaptured();
  const { subtreeRootId } = useSubtreeNav(tree);

  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  const searchOpen = useMindmapStore((s) => s.searchOpen);
  const closeSearch = useMindmapStore((s) => s.closeSearch);
  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const showCommitments = useViewStore((s) => s.zenCommitments);
  const showExpectations = useViewStore((s) => s.zenExpectations);
  const badgesSetting = useDisplayStore((s) => s.zenShowBadges);
  const showsStarted = useDisplayStore((s) => s.zenShowsStarted);
  const showOverdueBorder = useDisplayStore((s) => s.zenShowOverdueBorder);
  const agenticPills = useListFilterStore((s) => s.filter.pills.agentic);
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);

  const nodeEditor = useNodeEditor({ tree, allTasksAndGoals, reload });
  const { setEditorModal, onDoubleClick: openEditor } = nodeEditor;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const find = (id: string) => findNode(tree, id);
  const { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt } = useTaskBacklog({ findNode: find, reload, showToast });
  const { toggleAgentic } = useTaskAgentic({ findNode: find, reload, showToast });
  const { toggleAsynchronous } = useTaskAsynchronous({ findNode: find, reload, showToast });
  const { toggleCompound } = useTaskCompound({ findNode: find, reload, showToast });
  const quickPlan = useQuickPlan({ findNode: find, reload, showToast });
  const quickDependency = useQuickDependency({ tree, findNode: find, reload, showToast });
  const openAsyncTemplate = useOpenAsyncTemplate(tree, setEditorModal);
  const { markBroken, cycleVerdict } = useCommitmentVerdict({ findNode: find, reload, showToast });
  const { onUndo, onRedo } = useUndo({ reload, showToast });
  const searchableNodes = useSearchableNodes(tree);

  // Renaming only: the Zen View creates nothing, so `createTaskUnder` is never called and the
  // "Escape discards a new task" half of this hook never has a new task to discard.
  const { editingTaskId, startRename, commitTitle, cancelTitleEdit } = useListCreate({
    createTask,
    deleteTask,
    renameTask: (id, title) => renameNode(id, "task", title),
    selectRow: setSelectedId,
    showToast,
  });

  const options = useMemo(
    () => ({ commitments: showCommitments, expectations: showExpectations, agentic: agenticPills, showsStarted }),
    [showCommitments, showExpectations, agenticPills, showsStarted],
  );
  // Keyed on the raw selection, as the List View's is: the exemption has to know what is selected
  // before the filter runs, and it ends with any filter, subtree or strip change.
  const focusExemptId = useFocusExemption(selectedId, [sharedFilter, subtreeRootId, options]);
  const contents = useMemo(
    () => zenContents({ tasks: rows, commitments: commitmentRows, expectations: expectationRows }, sharedFilter, options, focusExemptId),
    [rows, commitmentRows, expectationRows, sharedFilter, options, focusExemptId],
  );

  const { ref: gridRef, layout } = useZenGrid(contents.tasks.rows.length);
  const navigation: ZenNavigationModel = useMemo(() => ({
    commitments: contents.commitments.rows.map((row) => row.node.id),
    expectations: contents.expectations.rows.map((row) => row.node.id),
    tasks: contents.tasks.rows.map((row) => row.node.id),
    columns: layout.columns,
  }), [contents, layout.columns]);
  const drawnOrder = useMemo(() => zenDrawnOrder(navigation), [navigation]);

  // A selection the view no longer draws reads as none, rather than being cleared by an effect.
  const activeId = selectedId !== null && drawnOrder.includes(selectedId) ? selectedId : null;
  const selectedTask = contents.tasks.rows.find((row) => row.node.id === activeId);
  const selectedCommitmentId = navigation.commitments.includes(activeId ?? "") ? activeId : null;
  const selectedExpectationId = navigation.expectations.includes(activeId ?? "") ? activeId : null;

  // The grid is what scrolls, and what `J`/`K` move; the strips scroll sideways on their own, so a
  // strip card the selection lands on is brought into view here.
  const { containerRef: gridScrollRef, startScroll, scrollToEdge } = useListScroll(activeId);
  const stripsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeId === null || stripsRef.current === null) return;
    for (const card of stripsRef.current.querySelectorAll("[data-row-id]")) {
      if (card.getAttribute("data-row-id") !== activeId) continue;
      if (typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeId]);

  function handleNavigate(direction: ZenDirection) {
    const target = zenNavigationTarget(navigation, activeId, direction);
    if (target !== null) setSelectedId(target);
  }

  function handleJumpToEdge(edge: ListEdge) {
    const target = edge === "first" ? drawnOrder[0] : drawnOrder[drawnOrder.length - 1];
    if (target === undefined) return;
    setSelectedId(target);
    // Only the grid scrolls vertically; a strip card at the far end is brought in by the effect.
    if (navigation.tasks.includes(target)) scrollToEdge(edge);
  }

  const { pendingDelete, isDeleting, error: deleteError, requestDelete, confirmDelete, cancelDelete } = useListDelete({
    findNode: find,
    removeNode,
    neighbourAfterDelete: (id, deletedIds) => neighbourAfterDelete(drawnOrder, id, deletedIds),
    selectRow: setSelectedId,
    showToast,
  });

  useKeyboardZenView({
    isInputActive: isInputCaptured || planPrompt !== null || occurrencePrompt !== null,
    selectedTaskId: selectedTask === undefined ? null : selectedTask.node.id,
    selectedCommitmentId,
    selectedExpectationId,
    selectedRowId: activeId,
    isSelectedBlocked: selectedTask !== undefined && selectedTask.isBlocked,
    onToggleStarted,
    onNavigate: handleNavigate,
    onJumpToEdge: handleJumpToEdge,
    onScrollList: startScroll,
    onCycleStatus,
    onCycleVerdict: cycleVerdict,
    onMarkBroken: markBroken,
    onToggleRelease: toggleRelease,
    onBindWait: openAsyncTemplate,
    // Borrowed with the List View's Expectation context, but never dispatched: the Zen table
    // leaves out `Alt+E`'s list option and `Shift+E`'s create (see `ZEN_BINDINGS`).
    onSetExpectationsPreset: () => {},
    onCreateExpectation: () => {},
    onOpenEditor: openEditor,
    onStartRename: startRename,
    onDelete: requestDelete,
    onDeselect: () => setSelectedId(null),
    onToggleBacklog: toggleBacklog,
    onToggleAgentic: toggleAgentic,
    onToggleAsynchronous: toggleAsynchronous,
    onToggleCompound: toggleCompound,
    onQuickPlan: quickPlan.open,
    onQuickDependency: quickDependency.open,
    onToggleFullscreen: toggleFullscreen,
    onRefuseStatusPreset: () => showToast({ nodeId: PRESET_TOAST_ANCHOR, message: t("zenView:presetLocked") }),
    onUndo,
    onRedo,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  const showBadges = zenCardShowsBadges(layout.cardHeight, badgesSetting);
  const text = zenTextSize(layout.cardWidth, layout.cardHeight, showBadges);

  return (
    <div className={styles.container}>
      <AnchoredToast toast={pendingToast} onDismiss={clearToast} />

      {quickPlan.target !== null && (
        <QuickPlanPicker
          target={quickPlan.target}
          anchorAttribute="data-row-id"
          onApply={(plan) => void quickPlan.apply(plan)}
          onClose={quickPlan.close}
        />
      )}
      {quickDependency.target !== null && (
        <QuickDependencyPicker
          target={quickDependency.target}
          anchorAttribute="data-row-id"
          onPick={(candidate) => void quickDependency.apply(candidate)}
          onClose={quickDependency.close}
        />
      )}

      <div ref={stripsRef} className={styles.strips}>
        <ZenStrip
          label={t("zenView:commitmentsStrip")}
          nodes={contents.commitments.rows.map((row) => row.node)}
          renderGlyph={(node, r) => (
            <CommitmentIcon
              cx={r} cy={r} r={r * 0.9} color="var(--text-primary)" opacity={1}
              state={commitmentGlyphState(node.verdict, node.archived === true)}
            />
          )}
          selectedId={activeId}
          exemptedIds={contents.commitments.exemptedIds}
          onSelect={setSelectedId}
          onOpenEditor={openEditor}
        />
        <ZenStrip
          label={t("zenView:expectationsStrip")}
          nodes={contents.expectations.rows.map((row) => row.node)}
          renderGlyph={(node, r) => (
            <ExpectationIcon cx={r} cy={r} r={r * 0.9} color="var(--text-primary)" opacity={1} status={node.status} />
          )}
          selectedId={activeId}
          exemptedIds={contents.expectations.exemptedIds}
          onSelect={setSelectedId}
          onOpenEditor={openEditor}
        />
      </div>

      <div
        ref={(element) => { gridRef(element); gridScrollRef.current = element; }}
        className={styles.gridArea}
      >
        {contents.tasks.rows.length === 0 ? (
          <div className={styles.centered}>{t("zenView:empty")}</div>
        ) : (
          <div className={styles.grid} role="list" aria-label={t("zenView:gridLabel")} style={{ gap: ZEN_GAP_PX }}>
            {contents.tasks.rows.map((row) => (
              <ZenTaskCard
                key={row.node.id}
                row={row}
                width={layout.cardWidth}
                height={layout.cardHeight}
                text={text}
                showBadges={showBadges}
                showOverdueBorder={showOverdueBorder}
                isSelected={row.node.id === activeId}
                isFocusExempt={contents.tasks.exemptedIds.has(row.node.id)}
                isEditingTitle={row.node.id === editingTaskId}
                onSelect={setSelectedId}
                onOpenEditor={openEditor}
                onCommitTitle={commitTitle}
                onCancelTitleEdit={cancelTitleEdit}
              />
            ))}
          </div>
        )}
      </div>

      {searchOpen && (
        <NodeSearchModal
          nodes={searchableNodes}
          onSelect={(id) => { enterSubtree(id); closeSearch(); }}
          onClose={closeSearch}
        />
      )}

      <NodeEditorModals tree={tree} editor={nodeEditor} />

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
        <UnfinishedChildrenModal prompt={occurrencePrompt} onConfirm={confirmOccurrence} onCancel={cancelOccurrence} />
      )}
      {planPrompt !== null && (
        <BacklogConfirmModal prompt={planPrompt} onConfirm={confirmClearPlan} onCancel={cancelPlanPrompt} />
      )}
    </div>
  );
}
