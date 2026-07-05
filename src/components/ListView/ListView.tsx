import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterTaskList } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import { groupRowsByGoal } from "@/utils/list-data";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useKeyboardListView } from "./use-keyboard-list-view";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import Switch from "@/components/Switch/Switch";
import TaskRow from "./TaskRow";
import GoalHeaderRow from "./GoalHeaderRow";
import styles from "./ListView.module.css";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor"]);
  const { tree, rows, allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode } = useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);

  const listFilter = useListFilterStore((s) => s.filter);
  const toggleShowGoalHeaders = useListFilterStore((s) => s.toggleShowGoalHeaders);
  const addPill = useListFilterStore((s) => s.addPill);
  const setListPreset = useListFilterStore((s) => s.setPreset);

  const { editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick, onTaskSave, checkScopeClamp } =
    useNodeEditor({ tree, allTasksAndGoals, reload });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const filteredRows = useMemo(
    () => filterTaskList(rows, sharedFilter, listFilter),
    [rows, sharedFilter, listFilter],
  );
  const entries = useMemo(
    () => groupRowsByGoal(filteredRows, listFilter.showGoalHeaders),
    [filteredRows, listFilter.showGoalHeaders],
  );
  const taskIds = useMemo(
    () => entries.filter((entry) => entry.type === "task").map((entry) => entry.row.node.id),
    [entries],
  );
  // Derived rather than cleared via an effect: a stale selection (e.g. filtered out) just reads as none.
  const activeSelectedId = selectedTaskId !== null && taskIds.includes(selectedTaskId) ? selectedTaskId : null;
  const selectedRow = filteredRows.find((row) => row.node.id === activeSelectedId);
  const isSelectedBlocked = selectedRow !== undefined && selectedRow.isBlocked && selectedRow.node.habitItem === undefined;

  function handleNavigate(direction: 1 | -1) {
    if (taskIds.length === 0) return;
    if (activeSelectedId === null) {
      setSelectedTaskId(direction === 1 ? (taskIds[0] ?? null) : (taskIds[taskIds.length - 1] ?? null));
      return;
    }
    const index = taskIds.indexOf(activeSelectedId);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= taskIds.length) return;
    setSelectedTaskId(taskIds[nextIndex] ?? null);
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
    isInputActive: editingTaskId !== null || editorModal !== null,
    selectedTaskId: activeSelectedId,
    isSelectedBlocked,
    onNavigate: handleNavigate,
    onCycleStatus,
    onOpenEditor: onDoubleClick,
    onStartRename: setEditingTaskId,
    onDeselect: () => setSelectedTaskId(null),
    onToggleFilter: toggleFilterPopover,
    onSetStatusMode: handleSetStatusPreset,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Switch checked={listFilter.showGoalHeaders} onChange={toggleShowGoalHeaders} label={t("listView:showGoalHeaders")} />
      </div>

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
                onSelect={setSelectedTaskId}
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
    </div>
  );
}
