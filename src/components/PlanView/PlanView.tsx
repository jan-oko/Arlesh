import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { usePlanScope } from "@/hooks/use-plan-scope";
import { usePlanMove } from "@/hooks/use-plan-move";
import { useScopeWindows } from "@/hooks/use-scope-windows";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useUndo } from "@/hooks/use-undo";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useFilterStore } from "@/stores/use-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { BEADS_NODE_TYPE } from "@/api/beads";
import type { FilterState } from "@/utils/filter-tree";
import type { TaskListRow } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, filterTaskList } from "@/utils/list-filter";
import { partitionForScope, referencedScopeIds } from "@/utils/plan-triage";
import type { PlanPanes } from "@/utils/plan-triage";
import type { PlanPane } from "@/utils/hotkeys/plan-bindings";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import PlanScopeBar from "./PlanScopeBar";
import PlanTaskCard from "./PlanTaskCard";
import { useKeyboardPlanView } from "./use-keyboard-plan-view";
import styles from "./PlanView.module.css";

const NO_PANES: PlanPanes = { candidates: [], planned: [] };

/** The index the selection lands on after `direction` steps from `current` within `length` rows. */
function nextIndex(current: number, direction: 1 | -1, length: number): number | null {
  if (length === 0) return null;
  if (current < 0) return direction === 1 ? 0 : length - 1;
  const moved = current + direction;
  if (moved < 0 || moved >= length) return current;
  return moved;
}

/**
 * The **Plan View**: one scope at a time, as a two-pane triage.
 *
 * On the left is the work that is relevant now and unscheduled; on the right is what the scope
 * already holds. Moving a card across sets its Plan and moving it back clears it, which is the
 * whole of what this view writes — a Time Scope is a statement about when a task *matters* and
 * changing one is an editing decision, so it stays in the editor.
 *
 * It reads the same tree the Mindmap and the List View read, through the same shared subtree root
 * and the same shared filter, so entering a subtree anywhere in the tab narrows this too and the
 * three views are three readings of one board rather than three boards.
 */
export default function PlanView() {
  const { t } = useTranslation(["common", "planView"]);
  const { tree, rows, allTasksAndGoals, isLoading, error, reload } = useListData();

  const sharedFilter = useFilterStore((s) => s.filter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const isInputCaptured = useIsInputCaptured();
  const { subtreeRootId, onExitSubtree, onExitToRoot } = useSubtreeNav(tree);
  const { onUndo, onRedo } = useUndo({ reload, showToast });

  const scope = usePlanScope();
  const [showBacklogged, setShowBacklogged] = useState(false);
  const [pane, setPane] = useState<PlanPane>("candidates");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick, onTaskSave,
    onClearBeadsId, checkScopeClamp,
  } = useNodeEditor({ tree, allTasksAndGoals, reload });

  // Backlog is the one filter dimension this view answers for itself. The switch *is* the backlog
  // question here, so it overrides the shared pill rather than combining with it — otherwise
  // turning it on under the Plan preset, which hides backlogged work of its own accord, would be a
  // control that visibly did nothing.
  const filter = useMemo<FilterState>(
    () => ({ ...sharedFilter, backlogMode: showBacklogged ? "include" : "exclude" }),
    [sharedFilter, showBacklogged],
  );
  // The List View's own pill dimensions are its own; what the three views share is this filter.
  const visibleRows = useMemo(
    () => filterTaskList(rows, filter, DEFAULT_LIST_FILTER),
    [rows, filter],
  );

  const targetScopeId = scope.scope?.id ?? null;
  const scopeIds = useMemo(() => {
    const ids = referencedScopeIds(visibleRows);
    if (targetScopeId !== null) ids.push(targetScopeId);
    return ids;
  }, [visibleRows, targetScopeId]);
  const windows = useScopeWindows(scopeIds);
  const targetWindow = targetScopeId === null ? null : windows.get(targetScopeId) ?? null;

  const panes = useMemo(
    () => (targetWindow === null ? NO_PANES : partitionForScope(visibleRows, targetWindow, windows)),
    [visibleRows, targetWindow, windows],
  );

  const { planInto, unplan } = usePlanMove({
    targetScopeId, targetWindow, targetLabel: scope.label, windows, reload, showToast,
  });

  const paneRows = pane === "candidates" ? panes.candidates : panes.planned;

  const onNavigate = useCallback(
    (direction: 1 | -1) => {
      const current = paneRows.findIndex((row) => row.node.id === selectedTaskId);
      const landing = nextIndex(current, direction, paneRows.length);
      setSelectedTaskId(landing === null ? null : paneRows[landing]?.node.id ?? null);
    },
    [paneRows, selectedTaskId],
  );

  // Crossing to the other pane keeps your place in the list rather than starting over at the top:
  // the two panes are read side by side, and the row opposite the one you were on is the one you
  // were looking at.
  const onFocusPane = useCallback(
    (next: PlanPane) => {
      if (next === pane) return;
      const current = paneRows.findIndex((row) => row.node.id === selectedTaskId);
      const target = next === "candidates" ? panes.candidates : panes.planned;
      const landing = Math.min(Math.max(current, 0), target.length - 1);
      setPane(next);
      setSelectedTaskId(target.length === 0 ? null : target[landing]?.node.id ?? null);
    },
    [pane, paneRows, panes, selectedTaskId],
  );

  const move = useCallback(
    (row: TaskListRow, from: PlanPane) => {
      const list = from === "candidates" ? panes.candidates : panes.planned;
      const index = list.findIndex((candidate) => candidate.node.id === row.node.id);
      const successor = list[index + 1] ?? list[index - 1] ?? null;
      void (from === "candidates" ? planInto(row) : unplan(row)).then((moved) => {
        // Only a move that happened advances the cursor. A refused one leaves the selection on the
        // task the toast is about, which is the one you are being told something about.
        if (moved) setSelectedTaskId(successor?.node.id ?? null);
      });
    },
    [panes, planInto, unplan],
  );

  const onMoveAcross = useCallback(
    (id: string) => {
      const row = paneRows.find((candidate) => candidate.node.id === id);
      if (row === undefined) return;
      move(row, pane);
    },
    [move, pane, paneRows],
  );

  useKeyboardPlanView({
    isInputActive: isInputCaptured || editorModal !== null,
    pane,
    selectedTaskId,
    onNavigate,
    onFocusPane,
    onMoveAcross,
    onStepScope: scope.step,
    onToggleBacklogCandidates: () => setShowBacklogged((on) => !on),
    onToggleFilter: toggleFilterPopover,
    onSetStatusMode: setStatusMode,
    onOpenEditor: onDoubleClick,
    onDeselect: () => setSelectedTaskId(null),
    onToggleFullscreen: toggleFullscreen,
    subtreeRootId,
    onExitSubtree,
    onExitToRoot,
    onUndo,
    onRedo,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  function renderPane(which: PlanPane, heading: string, list: readonly TaskListRow[], empty: ReactNode) {
    return (
      <section
        className={`${styles.pane}${pane === which ? ` ${styles.paneFocused}` : ""}`}
        aria-label={heading}
        data-plan-pane={which}
        onClick={() => setPane(which)}
      >
        <h2 className={styles.paneHeading}>{heading}</h2>
        {list.length === 0 ? empty : (
          <div className={styles.cards}>
            {list.map((row) => (
              <PlanTaskCard
                key={row.node.id}
                row={row}
                isSelected={row.node.id === selectedTaskId}
                direction={which === "candidates" ? "in" : "out"}
                onSelect={(id) => { setPane(which); setSelectedTaskId(id); }}
                onMove={(moved) => move(moved, which)}
                onOpenEditor={onDoubleClick}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={styles.container}>
      <AnchoredToast toast={pendingToast} onDismiss={clearToast} />

      <PlanScopeBar
        cursor={scope.cursor}
        label={scope.label}
        showBacklogged={showBacklogged}
        onSetKind={scope.setKind}
        onStep={scope.step}
        onJumpTo={scope.jumpTo}
        onToggleBacklogged={() => setShowBacklogged((on) => !on)}
      />

      {scope.error !== null ? (
        <div className={styles.centered}>{t("planView:scopeFailed", { message: scope.error })}</div>
      ) : (
        <div className={styles.panes}>
          {renderPane(
            "candidates",
            t("planView:candidatesHeading"),
            panes.candidates,
            <p className={styles.empty}>
              {t("planView:candidatesEmpty")}
              {!showBacklogged && <span className={styles.hint}>{t("planView:candidatesEmptyBacklogHint")}</span>}
            </p>,
          )}
          {renderPane(
            "planned",
            t("planView:plannedHeading"),
            panes.planned,
            <p className={styles.empty}>{t("planView:plannedEmpty")}</p>,
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
          onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.TASK)}
          onCheckScopeClamp={checkScopeClamp}
          onClose={() => setEditorModal(null)}
        />
      )}
    </div>
  );
}
