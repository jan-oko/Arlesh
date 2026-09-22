import { Fragment, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { usePlanScope } from "@/hooks/use-plan-scope";
import { usePlanMove } from "@/hooks/use-plan-move";
import { useScopeWindows } from "@/hooks/use-scope-windows";
import { useScopeRows } from "@/hooks/use-scope-rows";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useUndo } from "@/hooks/use-undo";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { BEADS_NODE_TYPE } from "@/api/beads";
import type { FilterState } from "@/utils/filter-tree";
import type { TaskListRow } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, filterTaskList } from "@/utils/list-filter";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import { partitionForScope, referencedScopeIds } from "@/utils/plan-triage";
import { buildPlanSections } from "@/utils/plan-sections";
import type { PlanSection } from "@/utils/plan-sections";
import { groupRowsByPath } from "@/utils/list-data";
import type { PathGroupedEntry } from "@/utils/list-data";
import type { PlanPanes } from "@/utils/plan-triage";
import type { PlanPane } from "@/utils/hotkeys/plan-bindings";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import PathHeaderRow from "@/components/ListView/PathHeaderRow";
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
 * One drawn run of a pane: an optional section header, and the entries under it.
 *
 * A block is flat on purpose. The keyboard walks a pane as one ordered list of task rows, so
 * headers have to be *entries in the stream* rather than wrappers around one — the same reasoning
 * the List View's path headers and asynchronous markers are built on. Nothing a block draws is
 * landable; `rows` below is what the selection moves through.
 */
interface PaneBlock {
  key: string;
  section: PlanSection | null;
  entries: PathGroupedEntry[];
}

/** A pane, ready to draw, plus the row order the keyboard walks. */
interface PaneModel {
  blocks: PaneBlock[];
  /** Every task row in the pane, in the order it is drawn. Headers are not in here. */
  rows: TaskListRow[];
  /** Whether sections are drawn, which decides if an empty pane says so or shows empty buckets. */
  sectioned: boolean;
}

/** Path headers are the caller's choice; without them a run is just its rows. */
function entriesFor(rows: readonly TaskListRow[], grouped: boolean): PathGroupedEntry[] {
  if (grouped) return groupRowsByPath(rows);
  return rows.map((row) => ({ type: "task", row, visibleDepth: 0 }));
}

/** Assembles a pane from its sections, or from one flat run when it is not split. */
function paneModel(sections: PlanSection[] | null, rows: readonly TaskListRow[], grouped: boolean): PaneModel {
  if (sections === null) {
    return { blocks: [{ key: "all", section: null, entries: entriesFor(rows, grouped) }], rows: [...rows], sectioned: false };
  }
  return {
    blocks: sections.map((section) => ({ key: section.key, section, entries: entriesFor(section.rows, grouped) })),
    rows: sections.flatMap((section) => section.rows),
    sectioned: true,
  };
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
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  // Ctrl+O is a global binding; the flag it raises is read here, where the loaded tree already is.
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);
  const searchOpen = useMindmapStore((s) => s.searchOpen);
  const closeSearch = useMindmapStore((s) => s.closeSearch);
  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const showToast = useMindmapStore((s) => s.showToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const isInputCaptured = useIsInputCaptured();
  // Publishes the tab's subtree descriptor for the top bar; the exits are global bindings.
  useSubtreeNav(tree);
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
  // Resolved from the **unfiltered** rows: the shared filter now carries a scope selection of its
  // own, which is itself a comparison over windows, so the windows have to exist before the filter
  // can be applied rather than after it. A row the filter then drops cost one cached lookup.
  const targetScopeId = scope.scope?.id ?? null;
  const scopeSelection = filter.scope;
  const scopeIds = useMemo(() => {
    const ids = referencedScopeIds(rows);
    if (targetScopeId !== null) ids.push(targetScopeId);
    if (scopeSelection !== null) ids.push(scopeSelection.startId, scopeSelection.endId);
    return ids;
  }, [rows, targetScopeId, scopeSelection]);
  const windows = useScopeWindows(scopeIds);
  const targetWindow = targetScopeId === null ? null : windows.get(targetScopeId) ?? null;

  // The List View's own pill dimensions are its own; what the three views share is this filter.
  const visibleRows = useMemo(
    () => filterTaskList(rows, filter, DEFAULT_LIST_FILTER, windows),
    [rows, filter, windows],
  );

  const panes = useMemo(
    () => (targetWindow === null ? NO_PANES : partitionForScope(visibleRows, targetWindow, windows)),
    [visibleRows, targetWindow, windows],
  );

  const { planInto, unplan } = usePlanMove({
    targetScopeId, targetWindow, targetLabel: scope.label, windows, reload, showToast,
  });

  // The two shape switches, app-wide like the List View's own (see `use-display-store`).
  const planPathGrouping = useDisplayStore((s) => s.planPathGrouping);
  // The same app-wide glyph choice the List View's headers read; one header, one setting.
  const pathHeaderIcons = useDisplayStore((s) => s.pathHeaderIcons);
  const planSubscopeSplit = useDisplayStore((s) => s.planSubscopeSplit);
  const setPillSide = useListFilterStore((s) => s.setPillSide);

  // Which *calendar cell* each plan names, which is a different question from the window it spans
  // and is answered in dates rather than instants — see `plan-sections`. Only asked for while the
  // split is on, so the pane costs nothing extra with the switch off.
  const sectionScopeIds = useMemo(() => {
    if (!planSubscopeSplit || targetScopeId === null) return [];
    const ids = [targetScopeId];
    for (const row of panes.planned) {
      const plan = row.node.plan;
      if (plan != null) ids.push(plan.start_id, plan.end_id);
    }
    return ids;
  }, [planSubscopeSplit, targetScopeId, panes.planned]);
  const scopeRows = useScopeRows(sectionScopeIds);

  const plannedSections = useMemo(() => {
    if (!planSubscopeSplit || targetScopeId === null) return null;
    const target = scopeRows.get(targetScopeId);
    // Until the scope being filled has been read back there is nothing to split by, and the pane
    // draws flat rather than inventing buckets.
    if (target === undefined) return null;
    return buildPlanSections(panes.planned, target, scopeRows);
  }, [planSubscopeSplit, targetScopeId, scopeRows, panes.planned]);

  const candidatesModel = useMemo(
    () => paneModel(null, panes.candidates, planPathGrouping),
    [panes.candidates, planPathGrouping],
  );
  const plannedModel = useMemo(
    () => paneModel(plannedSections, panes.planned, planPathGrouping),
    [plannedSections, panes.planned, planPathGrouping],
  );

  // The keyboard walks what is drawn. With the split on, the planned pane's order is its sections'
  // order, which is not the triage's — so the flat array the selection moves through has to come
  // from the model rather than from `panes`, or Down would jump between buckets.
  const paneRowsOf = useCallback(
    (which: PlanPane) => (which === "candidates" ? candidatesModel.rows : plannedModel.rows),
    [candidatesModel, plannedModel],
  );
  const paneRows = paneRowsOf(pane);

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
      const target = paneRowsOf(next);
      const landing = Math.min(Math.max(current, 0), target.length - 1);
      setPane(next);
      setSelectedTaskId(target.length === 0 ? null : target[landing]?.node.id ?? null);
    },
    [pane, paneRows, paneRowsOf, selectedTaskId],
  );

  const move = useCallback(
    (row: TaskListRow, from: PlanPane) => {
      // The successor is the next card *on screen*, which under a split is the next one in its
      // section rather than the next one the triage produced.
      const list = paneRowsOf(from);
      const index = list.findIndex((candidate) => candidate.node.id === row.node.id);
      const successor = list[index + 1] ?? list[index - 1] ?? null;
      void (from === "candidates" ? planInto(row) : unplan(row)).then((moved) => {
        // Only a move that happened advances the cursor. A refused one leaves the selection on the
        // task the toast is about, which is the one you are being told something about.
        if (moved) setSelectedTaskId(successor?.node.id ?? null);
      });
    },
    [paneRowsOf, planInto, unplan],
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
    onSetStatusMode: setStatusMode,
    onOpenEditor: onDoubleClick,
    onDeselect: () => setSelectedTaskId(null),
    onToggleFullscreen: toggleFullscreen,
    onUndo,
    onRedo,
  });

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

  function sectionHeading(section: PlanSection) {
    if (section.unbucketed) {
      return (
        <h3 className={`${styles.sectionHeading} ${styles.sectionLoose}`}>
          {t("planView:unbucketedHeading")}
        </h3>
      );
    }
    return (
      <h3 className={styles.sectionHeading}>
        <span className={styles.sectionName}>{section.label}</span>
        {/* A month's first and last weeks usually poke outside it. They are drawn and said to be
            partial, with their dates, rather than dropped — a bucket left out would hide whatever
            is planned into it from this scope's view entirely. */}
        {section.partial && section.range !== null && (
          <span className={styles.sectionPartial}>
            {t("planView:subscopePartial", { start: section.range.startDate, end: section.range.endDate })}
          </span>
        )}
      </h3>
    );
  }

  function renderPane(which: PlanPane, heading: string, model: PaneModel, empty: ReactNode) {
    // With the split on, an empty pane still has buckets to show: an empty week is the answer to
    // "what is in this month" just as much as a full one.
    const showEmpty = model.rows.length === 0 && !model.sectioned;
    return (
      <section
        className={`${styles.pane}${pane === which ? ` ${styles.paneFocused}` : ""}`}
        aria-label={heading}
        data-plan-pane={which}
        onClick={() => setPane(which)}
      >
        <h2 className={styles.paneHeading}>{heading}</h2>
        {showEmpty ? empty : (
          <div className={styles.cards}>
            {model.blocks.map((block) => (
              <Fragment key={block.key}>
                {block.section !== null && sectionHeading(block.section)}
                {block.section !== null && block.entries.length === 0 && (
                  <p className={styles.sectionEmpty}>{t("planView:subscopeEmpty")}</p>
                )}
                {block.entries.map((entry, index) => (
                  entry.type === "path" ? (
                    <PathHeaderRow
                      key={`path-${block.key}-${index}-${entry.pathKey}`}
                      segments={entry.segments}
                      onEnterSubtree={enterSubtree}
                      onFilterByAntecedent={(id, side) => setPillSide("antecedent", id, side)}
                      showKindIcon={pathHeaderIcons}
                      // The Plan View writes Plans and nothing else, so it offers no way to create
                      // a Task from a header — absent rather than present and always refusing.
                      onCreateTask={null}
                    />
                  ) : (
                    <PlanTaskCard
                      key={entry.row.node.id}
                      row={entry.row}
                      isSelected={entry.row.node.id === selectedTaskId}
                      direction={which === "candidates" ? "in" : "out"}
                      onSelect={(id) => { setPane(which); setSelectedTaskId(id); }}
                      onMove={(moved) => move(moved, which)}
                      onOpenEditor={onDoubleClick}
                    />
                  )
                ))}
              </Fragment>
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
            candidatesModel,
            <p className={styles.empty}>
              {t("planView:candidatesEmpty")}
              {!showBacklogged && <span className={styles.hint}>{t("planView:candidatesEmptyBacklogHint")}</span>}
            </p>,
          )}
          {renderPane(
            "planned",
            t("planView:plannedHeading"),
            plannedModel,
            <p className={styles.empty}>{t("planView:plannedEmpty")}</p>,
          )}
        </div>
      )}

      {searchOpen && (
        <NodeSearchModal
          nodes={collectSearchableNodes(tree)}
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
    </div>
  );
}
