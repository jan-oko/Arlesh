import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useCommitmentVerdict } from "@/hooks/use-commitment-verdict";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { findNode } from "@/utils/mindmap-tree";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterCommitmentList, filterTaskListWithFocus } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import { groupRowsByPath } from "@/utils/list-data";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useKeyboardListView } from "./use-keyboard-list-view";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskRow from "./TaskRow";
import CommitmentRow from "./CommitmentRow";
import PathHeaderRow from "./PathHeaderRow";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import styles from "./ListView.module.css";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useFocusExemption } from "@/hooks/use-focus-exemption";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useViewStore } from "@/stores/use-view-store";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor"]);
  const { tree, rows, commitmentRows, allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode } =
    useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  // The cheat-sheet overlay gates background shortcuts the same way an open modal does.
  const isInputCaptured = useIsInputCaptured();
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);

  // Subtree entry is shared state, not a filter: the Mindmap and the List View re-root together.
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  const pathHeaderIcons = useViewStore((s) => s.pathHeaderIcons);
  const { subtreeRootId, onExitSubtree, onExitToRoot } = useSubtreeNav(tree);

  const listFilter = useListFilterStore((s) => s.filter);
  const addPill = useListFilterStore((s) => s.addPill);
  const setListPreset = useListFilterStore((s) => s.setPreset);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onCommitmentSave, checkScopeClamp,
  } = useNodeEditor({ tree, allTasksAndGoals, reload });

  // One selection across both sections: a row is a Task or a Commitment, and which it is decides
  // what Enter does to it.
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const { toggleBacklog, planPrompt, confirmClearPlan, cancelPlanPrompt } = useTaskBacklog({
    findNode: (id) => findNode(tree, id),
    reload,
    showToast,
  });
  const { markKept, markBroken } = useCommitmentVerdict({
    findNode: (id) => findNode(tree, id),
    reload,
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
  const entries = useMemo(() => groupRowsByPath(filteredRows), [filteredRows]);
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

  function handleCommitTitle(id: string, title: string) {
    setEditingTaskId(null);
    const trimmed = title.trim();
    if (trimmed === "") return;
    void renameNode(id, "task", trimmed);
  }

  function handleSetStatusPreset(mode: StatusMode) {
    setStatusMode(mode);
    setListPreset(mode);
  }

  useKeyboardListView({
    // The prompt swallows the row keys while it is open, as the editor modal already does.
    isInputActive: isInputCaptured || planPrompt !== null,
    selectedTaskId,
    selectedCommitmentId,
    selectedRowId: activeSelectedId,
    isSelectedBlocked,
    onNavigate: handleNavigate,
    onCycleStatus,
    onOpenEditor: onDoubleClick,
    onStartRename: setEditingTaskId,
    onDeselect: () => setSelectedRowId(null),
    onToggleFilter: toggleFilterPopover,
    onSetStatusMode: handleSetStatusPreset,
    onToggleBacklog: toggleBacklog,
    onMarkKept: markKept,
    onMarkBroken: markBroken,
    onOpenSearch: () => setIsSearchOpen(true),
    subtreeRootId,
    onExitSubtree,
    onExitToRoot,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
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
                onAddParentFilter={(ref) => addPill("parent", ref)}
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
          {entries.map((entry, index) =>
            entry.type === "path" ? (
              <PathHeaderRow
                key={`path-${index}-${entry.pathKey}`}
                segments={entry.segments}
                onEnterSubtree={enterSubtree}
                showKindIcon={pathHeaderIcons}
              />
            ) : (
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
                onCommitTitle={handleCommitTitle}
                onCancelTitleEdit={() => setEditingTaskId(null)}
                onAddParentFilter={(ref) => addPill("parent", ref)}
                onAddTagFilter={addTagFilter}
              />
            ),
          )}
        </div>
      )}

      {isSearchOpen && (
        <NodeSearchModal
          nodes={searchableNodes}
          onSelect={(id) => { enterSubtree(id); setIsSearchOpen(false); }}
          onClose={() => setIsSearchOpen(false)}
        />
      )}

      {editorModal !== null && editorModal.node.kind === "task" && (
        <TaskEditorModal
          node={editorModal.node}
          allTags={allTags}
          domainNames={domainNames}
          availableForDep={availableForDep}
          onSave={onTaskSave}
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
          onClose={() => setEditorModal(null)}
        />
      )}

      {planPrompt !== null && (
        <BacklogConfirmModal prompt={planPrompt} onConfirm={confirmClearPlan} onCancel={cancelPlanPrompt} />
      )}
    </div>
  );
}
