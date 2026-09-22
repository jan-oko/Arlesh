import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import { useTaskAsynchronous } from "@/hooks/use-task-asynchronous";
import { useCommitmentVerdict } from "@/hooks/use-commitment-verdict";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { findNode } from "@/utils/mindmap-tree";
import { canParentNewTask } from "@/utils/node-meta";
import { storedAgenticState } from "@/utils/agentic";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterCommitmentList, filterTaskListWithFocus } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import type { MindmapNode } from "@/utils/tree-layout";
import { groupRowsByPath } from "@/utils/list-data";
import { withAsynchronousSection } from "@/utils/async-first";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { BEADS_NODE_TYPE } from "@/api/beads";
import { useKeyboardListView } from "./use-keyboard-list-view";
import { useUndo } from "@/hooks/use-undo";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskRow from "./TaskRow";
import CommitmentRow from "./CommitmentRow";
import PathHeaderRow from "./PathHeaderRow";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import UnfinishedChildrenModal from "@/components/UnfinishedChildrenModal/UnfinishedChildrenModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal/DeleteConfirmModal";
import styles from "./ListView.module.css";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import { useListCreate } from "@/hooks/use-list-create";
import { useListDelete } from "@/hooks/use-list-delete";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useListScroll } from "@/hooks/use-list-scroll";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useDisplayStore } from "@/stores/use-display-store";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor"]);
  const { tree, rows, commitmentRows, allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode,
    createTask, deleteTask, removeNode,
    occurrencePrompt, confirmOccurrence, cancelOccurrence } = useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  // The cheat-sheet overlay gates background shortcuts the same way an open modal does.
  const isInputCaptured = useIsInputCaptured();
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);

  // Subtree entry is shared state, not a filter: the Mindmap and the List View re-root together.
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  // Ctrl+O is global; the flag it raises is read here, where the loaded tree is.
  const searchOpen = useMindmapStore((s) => s.searchOpen);
  const closeSearch = useMindmapStore((s) => s.closeSearch);
  const pathHeaderIcons = useDisplayStore((s) => s.pathHeaderIcons);
  const asynchronousFirst = useDisplayStore((s) => s.asynchronousFirst);
  // Publishes the tab's subtree descriptor for the top bar; the exits themselves are global
  // bindings now and are driven from `ActiveTab`.
  const { subtreeRootId } = useSubtreeNav(tree);

  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const listFilter = useListFilterStore((s) => s.filter);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const setPillSide = useListFilterStore((s) => s.setPillSide);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onCommitmentSave, onClearBeadsId, checkScopeClamp,
  } = useNodeEditor({ tree, allTasksAndGoals, reload });

  // One selection across both sections: a row is a Task or a Commitment, and which it is decides
  // what Enter does to it.
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt } = useTaskBacklog({
    findNode: (id) => findNode(tree, id),
    reload,
    showToast,
  });
  const { toggleAgentic } = useTaskAgentic({
    findNode: (id) => findNode(tree, id),
    reload,
    showToast,
  });
  const { toggleAsynchronous } = useTaskAsynchronous({
    findNode: (id) => findNode(tree, id),
    reload,
    showToast,
  });
  const { markKept, markBroken, cycleVerdict } = useCommitmentVerdict({
    findNode: (id) => findNode(tree, id),
    reload,
    showToast,
  });

  // Creating a row and naming one are the same gesture here: a new Task arrives blank and opens
  // straight into its own inline rename, so Escape during that first naming takes the Task back.
  const { editingTaskId, startRename, createTaskUnder, commitTitle, cancelTitleEdit } = useListCreate({
    createTask,
    deleteTask,
    renameTask: (id, title) => renameNode(id, "task", title),
    selectRow: setSelectedRowId,
    showToast,
  });

  // Every node kind, exactly as the Mindmap's Ctrl+O searches them, and over the whole board
  // rather than the subtree you are standing in — the point of the chord is to get somewhere else.
  const searchableNodes = useMemo(() => collectSearchableNodes(tree), [tree]);

  // The focus exemption: the selected row stays in the list even once your own edit stops it matching
  // — cycling a task to Done under Plan no longer drops it out from under the cursor. It ends when the
  // selection moves or any filter changes; see use-focus-exemption.
  //
  // Keyed on `selectedRowId`, the raw selection state, and deliberately not on `selectedTaskId`:
  // since Commitments became selectable rows, `selectedTaskId` is derived from `filteredRows` and so
  // is only non-null for a row the filter already kept. Feeding that back in would be circular and
  // null in exactly the case the exemption exists for — the row your own edit just stopped matching.
  const focusExemptTaskId = useFocusExemption(selectedRowId, [sharedFilter, listFilter, subtreeRootId]);
  const { rows: filteredRows, exemptedIds: focusExemptIds } = useMemo(
    () => filterTaskListWithFocus(rows, sharedFilter, listFilter, focusExemptTaskId),
    [rows, sharedFilter, listFilter, focusExemptTaskId],
  );
  const filteredCommitments = useMemo(
    () => filterCommitmentList(commitmentRows, sharedFilter, listFilter),
    [commitmentRows, sharedFilter, listFilter],
  );
  // Split first, then grouped: with the setting on, the asynchronous work is pulled out of the
  // filtered set before any header is drawn, so each half is grouped by path on its own terms — the
  // section's rows gain the parent they left behind as a header segment, and the rows left below
  // keep the header and indentation their remaining ancestors give them. With it off nothing is
  // pulled out and the list is exactly what the tree ordered.
  const entries = useMemo(
    () => (asynchronousFirst ? withAsynchronousSection(filteredRows) : groupRowsByPath(filteredRows)),
    [filteredRows, asynchronousFirst],
  );
  const taskIds = useMemo(
    () => entries.filter((entry) => entry.type === "task").map((entry) => entry.row.node.id),
    [entries],
  );
  // Arrow keys run the commitments section first and the task rows after, in the order the two
  // are drawn — the band across the top is not a separate keyboard world.
  const navigableIds = useMemo(
    () => [...filteredCommitments.map((row) => row.node.id), ...taskIds],
    [filteredCommitments, taskIds],
  );
  // Derived rather than cleared via an effect: a stale selection (e.g. filtered out) just reads as none.
  const activeSelectedId =
    selectedRowId !== null && navigableIds.includes(selectedRowId) ? selectedRowId : null;
  const selectedRow = filteredRows.find((row) => row.node.id === activeSelectedId);
  const selectedCommitment = filteredCommitments.find((row) => row.node.id === activeSelectedId);
  const selectedTaskId = selectedRow !== undefined ? selectedRow.node.id : null;
  const selectedCommitmentId = selectedCommitment !== undefined ? selectedCommitment.node.id : null;
  const isSelectedBlocked = selectedRow !== undefined && selectedRow.isBlocked && selectedRow.node.habitItem === undefined;

  function handleNavigate(direction: 1 | -1) {
    if (navigableIds.length === 0) return;
    if (activeSelectedId === null) {
      setSelectedRowId(direction === 1 ? (navigableIds[0] ?? null) : (navigableIds[navigableIds.length - 1] ?? null));
      return;
    }
    const index = navigableIds.indexOf(activeSelectedId);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= navigableIds.length) return;
    setSelectedRowId(navigableIds[nextIndex] ?? null);
  }

  // The frame the list is drawn from — the subtree you have entered, or the whole board. It is the
  // parent for a sibling of a row that has no ancestor inside the list to share one with.
  const listRoot = useMemo(
    () => (subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree),
    [tree, subtreeRootId],
  );

  /** Shift+Enter: a sibling hangs from whatever the selected row hangs from, and carries over the
   * source's **own stored** Agentic flag — exactly as the Mindmap's Shift+Enter does, so the same
   * chord on the same Task cannot mean two things depending on which view you are in. */
  function handleCreateSibling(id: string) {
    const row = filteredRows.find((candidate) => candidate.node.id === id);
    if (row === undefined) return;
    createTaskUnder(row.ancestors[row.ancestors.length - 1] ?? listRoot, storedAgenticState(row.node.agentic));
  }

  /** Tab: a child hangs from the selected row itself. */
  function handleCreateChild(id: string) {
    const row = filteredRows.find((candidate) => candidate.node.id === id);
    if (row === undefined) return;
    createTaskUnder(row.node);
  }

  /** A path header's `+`, or `null` where the chain ends somewhere a Task cannot live. */
  function headerCreateHandler(segments: readonly MindmapNode[]): (() => void) | null {
    const parent = segments[segments.length - 1];
    if (parent === undefined || !canParentNewTask(parent)) return null;
    return () => createTaskUnder(parent);
  }

  /**
   * Where the selection lands once a row and its subtree are gone: the next row down, or the one
   * above when the deleted row was last, skipping anything that went with it.
   *
   * Deliberately not the Mindmap's rule of falling back to the nearest surviving *ancestor*. On a
   * flat list a row's ancestors are usually a Goal or a Project, which are never rows — that rule
   * would leave nothing selected most of the time. Stepping along the list is what the arrows
   * already do, and it is where a reader's eye is.
   */
  function neighbourAfterDelete(id: string, deletedIds: ReadonlySet<string>): string | null {
    const index = navigableIds.indexOf(id);
    if (index === -1) return null;
    const survives = (candidate: string | undefined): boolean =>
      candidate !== undefined && !deletedIds.has(candidate);
    for (let i = index + 1; i < navigableIds.length; i++) {
      if (survives(navigableIds[i])) return navigableIds[i] ?? null;
    }
    for (let i = index - 1; i >= 0; i--) {
      if (survives(navigableIds[i])) return navigableIds[i] ?? null;
    }
    return null;
  }

  function handleSetStatusPreset(mode: StatusMode) {
    setStatusMode(mode);
    setListPreset(mode);
  }

  // Deleting on the Mindmap's terms: its chord, its confirmation, its subtree cascade and its
  // writer — so one undo step covers a delete made from either view.
  const { pendingDelete, isDeleting, error: deleteError, requestDelete, confirmDelete, cancelDelete } =
    useListDelete({
      findNode: (id) => findNode(tree, id),
      removeNode,
      neighbourAfterDelete,
      selectRow: setSelectedRowId,
      showToast,
    });

  const { onUndo, onRedo } = useUndo({ reload, showToast });

  // The viewport: it follows the selection, and j/k roam it without moving the selection.
  const { containerRef, startScroll } = useListScroll(activeSelectedId);

  useKeyboardListView({
    // The prompt swallows the row keys while it is open, as the editor modal already does.
    isInputActive: isInputCaptured || planPrompt !== null || occurrencePrompt !== null,
    selectedTaskId,
    selectedCommitmentId,
    selectedRowId: activeSelectedId,
    onToggleFullscreen: toggleFullscreen,
    isSelectedBlocked,
    onNavigate: handleNavigate,
    onScrollList: startScroll,
    onCycleStatus,
    onOpenEditor: onDoubleClick,
    onStartRename: startRename,
    onCreateSibling: handleCreateSibling,
    onCreateChild: handleCreateChild,
    onDelete: requestDelete,
    onDeselect: () => setSelectedRowId(null),
    onSetStatusMode: handleSetStatusPreset,
    onSetUnblockPreset: () => setListPreset("unblock"),
    onToggleBacklog: toggleBacklog,
    onToggleAgentic: toggleAgentic,
    onToggleAsynchronous: toggleAsynchronous,
    onCycleVerdict: cycleVerdict,
    onMarkBroken: markBroken,
    onUndo,
    onRedo,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container} ref={containerRef}>
      <AnchoredToast toast={pendingToast} onDismiss={clearToast} />

      {filteredCommitments.length > 0 && (
        <section className={styles.commitments} aria-label={t("listView:commitmentsHeading")}>
          <h2 className={styles.commitmentsHeading}>{t("listView:commitmentsHeading")}</h2>
          <div className={styles.rows}>
            {filteredCommitments.map((row) => (
              <CommitmentRow
                key={row.node.id}
                row={row}
                isSelected={row.node.id === activeSelectedId}
                onSelect={setSelectedRowId}
                onMarkKept={markKept}
                onMarkBroken={markBroken}
                onOpenEditor={onDoubleClick}
                onAddTagFilter={addTagFilter}
              />
            ))}
          </div>
        </section>
      )}

      {entries.length === 0 ? (
        <div className={styles.centered}>{t("listView:empty")}</div>
      ) : (
        <div className={styles.rows}>
          {entries.map((entry, index) => {
            // The Asynchronous section's heading: drawn in the list's own flow rather than wrapped
            // in a section element, because the rows it collects are path-grouped runs like any
            // other and share the one arrow-key order.
            if (entry.type === "asynchronous") {
              return (
                <h2 key="asynchronous" className={styles.sectionHeading}>
                  {t("listView:asynchronousHeading")}
                </h2>
              );
            }
            // The rule that closes it. A wrapper with a border — the way the commitments band is
            // drawn — is not available here: the section's rows are entries in the same flat list
            // as everything below, and the keyboard walks that one order. So the boundary is an
            // entry too, and `withAsynchronousSection` omits it when nothing follows the section.
            if (entry.type === "asynchronousEnd") {
              return <hr key="asynchronous-end" className={styles.sectionEnd} />;
            }
            if (entry.type === "path") {
              return (
                <PathHeaderRow
                  key={`path-${index}-${entry.pathKey}`}
                  segments={entry.segments}
                  onEnterSubtree={enterSubtree}
                  // Ctrl/Alt-click on a segment narrows the list in place rather than re-rooting it:
                  // the same Antecedent pill the filter popover's combobox adds, on the element that
                  // already names the ancestors.
                  onFilterByAntecedent={(id, side) => setPillSide("antecedent", id, side)}
                  showKindIcon={pathHeaderIcons}
                  onCreateTask={headerCreateHandler(entry.segments)}
                />
              );
            }
            return (
              <TaskRow
                key={entry.row.node.id}
                row={entry.row}
                visibleDepth={entry.visibleDepth}
                isSelected={entry.row.node.id === activeSelectedId}
                isFocusExempt={focusExemptIds.has(entry.row.node.id)}
                isEditingTitle={entry.row.node.id === editingTaskId}
                onSelect={setSelectedRowId}
                onCycleStatus={onCycleStatus}
                onOpenEditor={onDoubleClick}
                onCommitTitle={commitTitle}
                onCancelTitleEdit={cancelTitleEdit}
                onAddTagFilter={addTagFilter}
              />
            );
          })}
        </div>
      )}

      {searchOpen && (
        <NodeSearchModal
          nodes={searchableNodes}
          onSelect={(id) => { enterSubtree(id); closeSearch(); }}
          onClose={closeSearch}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal
          node={editorModal.node}
          allTags={allTags}
          domainNames={domainNames}
          availableForDep={availableForDep}
          onSave={onTaskSave}
          onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.TASK)}
          onCheckScopeClamp={checkScopeClamp}
          onClose={() => setEditorModal(null)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "commitment" && (
        <CommitmentEditorModal
          node={editorModal.node}
          allTags={allTags}
          domainNames={domainNames}
          onSave={onCommitmentSave}
          onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.COMMITMENT)}
          onClose={() => setEditorModal(null)}
        />
      )}

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
