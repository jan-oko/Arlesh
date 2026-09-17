import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useTaskBacklog } from "@/hooks/use-task-backlog";
import { useCommitmentVerdict } from "@/hooks/use-commitment-verdict";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { findNode } from "@/utils/mindmap-tree";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterCommitmentList, filterTaskList } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import { groupRowsByGoal } from "@/utils/list-data";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useKeyboardListView } from "./use-keyboard-list-view";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import Switch from "@/components/Switch/Switch";
import TaskRow from "./TaskRow";
import CommitmentRow from "./CommitmentRow";
import GoalHeaderRow from "./GoalHeaderRow";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import BacklogConfirmModal from "@/components/BacklogConfirmModal/BacklogConfirmModal";
import type { Position } from "@/utils/tree-layout";
import styles from "./ListView.module.css";
import { useIsInputCaptured } from "@/hooks/use-input-capture";

/** A flat list lays out no nodes, so every anchored notice falls back to its fixed spot. */
const NO_POSITIONS: ReadonlyMap<string, Position> = new Map();

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

  const listFilter = useListFilterStore((s) => s.filter);
  const toggleShowGoalHeaders = useListFilterStore((s) => s.toggleShowGoalHeaders);
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

  const filteredRows = useMemo(
    () => filterTaskList(rows, sharedFilter, listFilter),
    [rows, sharedFilter, listFilter],
  );
  const filteredCommitments = useMemo(
    () => filterCommitmentList(commitmentRows, sharedFilter, listFilter),
    [commitmentRows, sharedFilter, listFilter],
  );
  const entries = useMemo(
    () => groupRowsByGoal(filteredRows, listFilter.showGoalHeaders),
    [filteredRows, listFilter.showGoalHeaders],
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
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
      <AnchoredToast toast={pendingToast} positions={NO_POSITIONS} onDismiss={clearToast} />
      <div className={styles.toolbar}>
        <Switch checked={listFilter.showGoalHeaders} onChange={toggleShowGoalHeaders} label={t("listView:showGoalHeaders")} />
      </div>

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
          {entries.map((entry) =>
            entry.type === "goal" ? (
              <GoalHeaderRow key={`goal-${entry.node.id}`} node={entry.node} />
            ) : (
              <TaskRow
                key={entry.row.node.id}
                row={entry.row}
                isSelected={entry.row.node.id === activeSelectedId}
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
