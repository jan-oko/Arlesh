import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { filterTaskList } from "@/utils/list-filter";
import type { StatusMode } from "@/utils/filter-tree";
import { groupRowsByPath } from "@/utils/list-data";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useKeyboardListView } from "./use-keyboard-list-view";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskRow from "./TaskRow";
import PathHeaderRow from "./PathHeaderRow";
import styles from "./ListView.module.css";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useMindmapStore } from "@/stores/use-mindmap-store";

export default function ListView() {
  const { t } = useTranslation(["common", "listView", "editor"]);
  const { tree, rows, allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode } = useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  // The cheat-sheet overlay gates background shortcuts the same way an open modal does.
  const isInputCaptured = useIsInputCaptured();
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);

  // Subtree entry is shared state, not a filter: the Mindmap and the List View re-root together.
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  const { subtreeRootId, onExitSubtree, onExitToRoot } = useSubtreeNav(tree);

  const listFilter = useListFilterStore((s) => s.filter);
  const addPill = useListFilterStore((s) => s.addPill);
  const setListPreset = useListFilterStore((s) => s.setPreset);

  const { editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick, onTaskSave, checkScopeClamp } =
    useNodeEditor({ tree, allTasksAndGoals, reload });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Every node kind, exactly as the Mindmap's Ctrl+O searches them, and over the whole board
  // rather than the subtree you are standing in — the point of the chord is to get somewhere else.
  const searchableNodes = useMemo(() => collectSearchableNodes(tree), [tree]);

  const filteredRows = useMemo(
    () => filterTaskList(rows, sharedFilter, listFilter),
    [rows, sharedFilter, listFilter],
  );
  const entries = useMemo(() => groupRowsByPath(filteredRows), [filteredRows]);
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
    isInputActive: isInputCaptured,
    selectedTaskId: activeSelectedId,
    isSelectedBlocked,
    onNavigate: handleNavigate,
    onCycleStatus,
    onOpenEditor: onDoubleClick,
    onStartRename: setEditingTaskId,
    onDeselect: () => setSelectedTaskId(null),
    onToggleFilter: toggleFilterPopover,
    onSetStatusMode: handleSetStatusPreset,
    onOpenSearch: () => setIsSearchOpen(true),
    subtreeRootId,
    onExitSubtree,
    onExitToRoot,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  return (
    <div className={styles.container}>
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
              />
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
    </div>
  );
}
