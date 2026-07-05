import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterTaskList } from "@/utils/list-filter";
import { groupRowsByGoal } from "@/utils/list-data";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import Switch from "@/components/Switch/Switch";
import TaskRow from "./TaskRow";
import GoalHeaderRow from "./GoalHeaderRow";
import styles from "./ListView.module.css";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor"]);
  const { tree, rows, allTasksAndGoals, isLoading, error, reload, onCycleStatus } = useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);

  const listFilter = useListFilterStore((s) => s.filter);
  const toggleShowGoalHeaders = useListFilterStore((s) => s.toggleShowGoalHeaders);
  const addPill = useListFilterStore((s) => s.addPill);

  const { editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick, onTaskSave, checkScopeClamp } =
    useNodeEditor({ tree, allTasksAndGoals, reload });

  const filteredRows = useMemo(
    () => filterTaskList(rows, sharedFilter, listFilter),
    [rows, sharedFilter, listFilter],
  );
  const entries = useMemo(
    () => groupRowsByGoal(filteredRows, listFilter.showGoalHeaders),
    [filteredRows, listFilter.showGoalHeaders],
  );

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
                onCycleStatus={onCycleStatus}
                onOpenEditor={onDoubleClick}
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
