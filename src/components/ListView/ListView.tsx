import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useTaskAgentic } from "@/hooks/use-task-agentic";
import { useTaskAsynchronous } from "@/hooks/use-task-asynchronous";
import { useCommitmentVerdict } from "@/hooks/use-commitment-verdict";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { findNode } from "@/utils/mindmap-tree";
import { canParentNewChild, canParentNewTask } from "@/utils/node-meta";
import { storedAgenticState } from "@/utils/agentic";
import { useFilterStore } from "@/stores/use-filter-store";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterCommitmentListWithFocus, filterExpectationListWithFocus, filterTaskListWithFocus } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import type { MindmapNode } from "@/utils/tree-layout";
import type { MixedListRow } from "@/utils/list-data";
import { groupMixedRowsByPath, mergeInTreeOrder, preOrderIndex } from "@/utils/list-data";
import { withAsynchronousSectionMixed } from "@/utils/async-first";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { BEADS_NODE_TYPE } from "@/api/beads";
import { useKeyboardListView } from "./use-keyboard-list-view";
import { useUndo } from "@/hooks/use-undo";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import ExpectationEditorModal from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import WaitEditors from "@/components/ExpectationEditorModal/WaitEditors";
import { useWaitEditor } from "@/hooks/use-wait-editor";
import { useOpenAsyncTemplate } from "@/hooks/use-open-async-template";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskRow from "./TaskRow";
import CommitmentRow from "./CommitmentRow";
import ExpectationRow from "./ExpectationRow";
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
import { neighbourAfterDelete } from "@/utils/neighbour-after-delete";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useListScroll } from "@/hooks/use-list-scroll";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useDisplayStore } from "@/stores/use-display-store";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor", "expectation"]);
  const { tree, rows, commitmentRows, expectationRows, listRoot: flattenRoot, toggleRelease,
    allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode,
    createTask, deleteTask, removeNode,
    occurrencePrompt, confirmOccurrence, cancelOccurrence } = useListData();

  const sharedFilter = useBoardFilter();
  // The cheat-sheet overlay gates background shortcuts the same way an open modal does.
  const isInputCaptured = useIsInputCaptured();
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);

  // Subtree entry is shared state, not a filter: the Mindmap and the List View re-root together.
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  // Ctrl+O is global; the flag it raises is read here, where the loaded tree is.
  const searchOpen = useMindmapStore((s) => s.searchOpen);
  const closeSearch = useMindmapStore((s) => s.closeSearch);
  const asynchronousFirst = useDisplayStore((s) => s.asynchronousFirst);
  // Bands above the rows, or rows among them — for Commitments and Expectations together.
  const listBands = useDisplayStore((s) => s.listBands);
  // Publishes the tab's subtree descriptor for the top bar; the exits themselves are global
  // bindings now and are driven from `ActiveTab`.
  const { subtreeRootId } = useSubtreeNav(tree);

  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const listFilter = useListFilterStore((s) => s.filter);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const setPillSide = useListFilterStore((s) => s.setPillSide);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onCommitmentSave, onExpectationSave, onClearBeadsId, checkScopeClamp,
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
  const waitEditor = useWaitEditor(tree, reload);
  const openAsyncTemplate = useOpenAsyncTemplate(tree, setEditorModal);
  const { markBroken, cycleVerdict } = useCommitmentVerdict({
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
  // The same exemption for a Commitment or a wait, in its band or among the rows: marking the
  // selected Commitment Kept under Plan must not pull it out from under the cursor any more than
  // cycling a Task to Done does.
  const { rows: filteredCommitments, exemptedIds: exemptCommitmentIds } = useMemo(
    () => filterCommitmentListWithFocus(commitmentRows, sharedFilter, listFilter, focusExemptTaskId),
    [commitmentRows, sharedFilter, listFilter, focusExemptTaskId],
  );
  const { rows: filteredExpectations, exemptedIds: exemptExpectationIds } = useMemo(
    () => filterExpectationListWithFocus(expectationRows, sharedFilter, listFilter, focusExemptTaskId),
    [expectationRows, sharedFilter, listFilter, focusExemptTaskId],
  );
  const treeOrder = useMemo(() => preOrderIndex(flattenRoot), [flattenRoot]);
  // In band mode the Commitments and Expectations sit in their bands and the list below is task
  // rows; in rows mode all three are merged back into the order the tree draws them, so a
  // Commitment or a wait sits exactly where it hangs, under the same path headers.
  const bandCommitments = useMemo(() => (listBands ? filteredCommitments : []), [listBands, filteredCommitments]);
  const bandExpectations = useMemo(() => (listBands ? filteredExpectations : []), [listBands, filteredExpectations]);
  // Split first, then grouped: with the setting on, the asynchronous work is pulled out of the
  // filtered set before any header is drawn, so each half is grouped by path on its own terms — the
  // section's rows gain the parent they left behind as a header segment, and the rows left below
  // keep the header and indentation their remaining ancestors give them. With it off nothing is
  // pulled out and the list is exactly what the tree ordered.
  const entries = useMemo(() => {
    const taskRows: MixedListRow[] = filteredRows.map((row) => ({ type: "task", row }));
    const mixed = listBands
      ? taskRows
      : mergeInTreeOrder([
        ...taskRows,
        ...filteredCommitments.map((row): MixedListRow => ({ type: "commitment", row })),
        ...filteredExpectations.map((row): MixedListRow => ({ type: "expectation", row })),
      ], treeOrder);
    return asynchronousFirst ? withAsynchronousSectionMixed(mixed) : groupMixedRowsByPath(mixed);
  }, [filteredRows, filteredCommitments, filteredExpectations, listBands, treeOrder, asynchronousFirst]);
  const rowIds = useMemo(
    () => entries.flatMap((entry) =>
      entry.type === "task" || entry.type === "commitment" || entry.type === "expectation" ? [entry.row.node.id] : []),
    [entries],
  );
  // Arrow keys run the bands first and the rows after, in the order they are drawn — a band
  // across the top is not a separate keyboard world.
  const navigableIds = useMemo(
    () => [...bandCommitments.map((row) => row.node.id), ...bandExpectations.map((row) => row.node.id), ...rowIds],
    [bandCommitments, bandExpectations, rowIds],
  );
  // Derived rather than cleared via an effect: a stale selection (e.g. filtered out) just reads as none.
  const activeSelectedId =
    selectedRowId !== null && navigableIds.includes(selectedRowId) ? selectedRowId : null;
  const selectedRow = filteredRows.find((row) => row.node.id === activeSelectedId);
  const selectedCommitment = filteredCommitments.find((row) => row.node.id === activeSelectedId);
  const selectedTaskId = selectedRow !== undefined ? selectedRow.node.id : null;
  const selectedCommitmentId = selectedCommitment !== undefined ? selectedCommitment.node.id : null;
  const selectedExpectation = filteredExpectations.find((row) => row.node.id === activeSelectedId);
  const selectedExpectationId = selectedExpectation !== undefined ? selectedExpectation.node.id : null;
  const isSelectedBlocked = selectedRow !== undefined && selectedRow.isBlocked;

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
  function rowAfterDelete(id: string, deletedIds: ReadonlySet<string>): string | null {
    return neighbourAfterDelete(navigableIds, id, deletedIds);
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
      neighbourAfterDelete: rowAfterDelete,
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
    selectedExpectationId,
    selectedRowId: activeSelectedId,
    onToggleRelease: toggleRelease,
    onSetExpectationsPreset: () => setListPreset("expectations"),
    onBindWait: openAsyncTemplate,
    onCreateExpectation: (id) => {
      const node = findNode(tree, id);
      if (node === undefined) return;
      if (!canParentNewChild(node, "expectation")) {
        showToast({ nodeId: id, message: t("expectation:createRefused") });
        return;
      }
      waitEditor.createUnder(id);
    },
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

      {bandCommitments.length > 0 && (
        <section className={styles.commitments} aria-label={t("listView:commitmentsHeading")}>
          <h2 className={styles.commitmentsHeading}>{t("listView:commitmentsHeading")}</h2>
          <div className={styles.rows}>
            {bandCommitments.map((row) => (
              <CommitmentRow
                key={row.node.id}
                row={row}
                isSelected={row.node.id === activeSelectedId}
                isFocusExempt={exemptCommitmentIds.has(row.node.id)}
                onSelect={setSelectedRowId}
                onCycleVerdict={cycleVerdict}
                onOpenEditor={onDoubleClick}
                onAddTagFilter={addTagFilter}
              />
            ))}
          </div>
        </section>
      )}

      {bandExpectations.length > 0 && (
        <section className={styles.commitments} aria-label={t("listView:expectationsHeading")}>
          <h2 className={styles.commitmentsHeading}>{t("listView:expectationsHeading")}</h2>
          <div className={styles.rows}>
            {bandExpectations.map((row) => (
              <ExpectationRow
                key={row.node.id}
                row={row}
                isSelected={row.node.id === activeSelectedId}
                isFocusExempt={exemptExpectationIds.has(row.node.id)}
                onSelect={setSelectedRowId}
                onToggleRelease={toggleRelease}
                onOpenEditor={onDoubleClick}
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
                  onCreateTask={headerCreateHandler(entry.segments)}
                />
              );
            }
            if (entry.type === "commitment") {
              return (
                <CommitmentRow
                  key={entry.row.node.id}
                  row={entry.row}
                  visibleDepth={entry.visibleDepth}
                  isSelected={entry.row.node.id === activeSelectedId}
                  isFocusExempt={exemptCommitmentIds.has(entry.row.node.id)}
                  onSelect={setSelectedRowId}
                  onCycleVerdict={cycleVerdict}
                  onOpenEditor={onDoubleClick}
                  onAddTagFilter={addTagFilter}
                />
              );
            }
            if (entry.type === "expectation") {
              return (
                <ExpectationRow
                  key={entry.row.node.id}
                  row={entry.row}
                  visibleDepth={entry.visibleDepth}
                  isSelected={entry.row.node.id === activeSelectedId}
                  isFocusExempt={exemptExpectationIds.has(entry.row.node.id)}
                  onSelect={setSelectedRowId}
                  onToggleRelease={toggleRelease}
                  onOpenEditor={onDoubleClick}
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
          openAtTemplate={editorModal.focus === "asyncTemplate"}
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

      <WaitEditors waitEditor={waitEditor} allTags={allTags} domainNames={domainNames} />
      {editorModal !== null && editorModal.node.kind === "expectation" && (
        <ExpectationEditorModal
          node={editorModal.node}
          allTags={allTags}
          domainNames={domainNames}
          onSave={onExpectationSave}
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
