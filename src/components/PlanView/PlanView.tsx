import { useCallback, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useListData } from "@/hooks/use-list-data";
import { usePlanScope } from "@/hooks/use-plan-scope";
import { usePlanMove } from "@/hooks/use-plan-move";
import { useScopeWindows } from "@/hooks/use-scope-windows";
import { useScopeRows } from "@/hooks/use-scope-rows";
import { useSubscopeLabel } from "@/hooks/use-subscope-label";
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
import { collectSearchableNodes, findNode } from "@/utils/mindmap-tree";
import { partitionForScope, referencedScopeIds } from "@/utils/plan-triage";
import { buildPlanSections } from "@/utils/plan-sections";
import type { PlanSection } from "@/utils/plan-sections";
import { buildPaneModel } from "@/utils/plan-pane-model";
import { assignSubscopeKeys } from "@/utils/plan-subscope-keys";
import { readPlanDrag, writePlanDrag } from "@/utils/plan-drag";
import {
  EMPTY_PLAN_SELECTION, navigateSelection, pruneSelection, selectOnly, selectRange, selectedInOrder,
  toggleSelected,
} from "@/utils/plan-selection";
import type { PlanPanes } from "@/utils/plan-triage";
import type { PlanPane as PlanPaneSide } from "@/utils/hotkeys/plan-bindings";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import PlanScopeBar from "./PlanScopeBar";
import PlanPane from "./PlanPane";
import type { SectionInfo } from "./PlanPane";
import type { PaneOption } from "./PaneMenu";
import type { SelectModifiers } from "./PlanTaskCard";
import { useKeyboardPlanView } from "./use-keyboard-plan-view";
import styles from "./PlanView.module.css";

const NO_PANES: PlanPanes = { unplanned: [], planned: [], coarser: [] };

/**
 * The **Plan View**: one scope at a time, as a two-pane triage.
 *
 * On the left is the work this pass has not placed yet; on the right is what the scope already
 * holds. Moving a card across sets its Plan and moving it back clears it, which is the whole of
 * what this view writes — a Time Scope is a statement about when a task *matters* and changing one
 * is an editing decision, so it stays in the editor.
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
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
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
  const subscopeLabel = useSubscopeLabel();
  const [showBacklogged, setShowBacklogged] = useState(false);
  const [pane, setPane] = useState<PlanPaneSide>("candidates");
  const [selection, setSelection] = useState(EMPTY_PLAN_SELECTION);

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

  const { planInto, planIntoSubscope, unplan } = usePlanMove({
    targetScopeId, targetWindow, targetLabel: scope.label, windows, reload, showToast,
  });

  // The four kebab switches, app-wide like the List View's own (see `use-display-store`).
  const groupByPath = useDisplayStore((s) => s.planCandidatesPathGrouping);
  const toggleGroupByPath = useDisplayStore((s) => s.togglePlanCandidatesPathGrouping);
  const parentOnly = useDisplayStore((s) => s.planCandidatesParentOnly);
  const toggleParentOnly = useDisplayStore((s) => s.togglePlanCandidatesParentOnly);
  const subscopeSplit = useDisplayStore((s) => s.planSubscopeSplit);
  const toggleSubscopeSplit = useDisplayStore((s) => s.togglePlanSubscopeSplit);
  const includePremorning = useDisplayStore((s) => s.planIncludePremorning);
  const toggleIncludePremorning = useDisplayStore((s) => s.togglePlanIncludePremorning);
  const setPillSide = useListFilterStore((s) => s.setPillSide);

  // Which *calendar cell* each plan names, which is a different question from the window it spans
  // and is answered in dates rather than instants — see `plan-sections`. Only asked for while the
  // split is on, so the pane costs nothing extra with the switch off.
  const sectionScopeIds = useMemo(() => {
    if (!subscopeSplit || targetScopeId === null) return [];
    const ids = [targetScopeId];
    for (const row of panes.planned) {
      const plan = row.node.plan;
      if (plan != null) ids.push(plan.start_id, plan.end_id);
    }
    return ids;
  }, [subscopeSplit, targetScopeId, panes.planned]);
  const scopeRows = useScopeRows(sectionScopeIds);

  const split = useMemo(() => {
    if (!subscopeSplit || targetScopeId === null) return null;
    const target = scopeRows.get(targetScopeId);
    // Until the scope being filled has been read back there is nothing to split by, and the pane
    // draws flat rather than inventing buckets.
    if (target === undefined) return null;
    return buildPlanSections(panes.planned, target, scopeRows, { includePremorning });
  }, [subscopeSplit, targetScopeId, scopeRows, panes.planned, includePremorning]);

  /**
   * The left-hand pane: **what this pass has not placed**.
   *
   * A pass fills *buckets* — the scope itself while the right-hand pane is flat, its subscopes once
   * it is split — and the parent scope is the scope one rung coarser than the bucket. Work planned
   * to the parent is inside it without being anywhere as fine as the pass is placing at, so it is
   * exactly the work that still needs a decision, and it is on this side because this is the side
   * with the gestures that make one.
   *
   * With the split on, that is also where the old catch-all's contents went: work pinned to the
   * scope while you look at its parts was drawn among the work that was already placed, in a
   * section that offered no way to move it.
   */
  const candidateRows = useMemo(() => {
    const unplaced = split?.unplaced ?? [];
    const parentPlanned = [...panes.coarser, ...unplaced];
    return parentOnly ? parentPlanned : [...parentPlanned, ...panes.unplanned];
  }, [split, panes.coarser, panes.unplanned, parentOnly]);

  const candidatesModel = useMemo(
    () => buildPaneModel(null, candidateRows, groupByPath),
    [candidateRows, groupByPath],
  );
  // The planned pane is read for *when*, which is the question its own switch answers; grouping by
  // location is the other pane's question, and nesting both here would have the sections and the
  // headers competing for the same column.
  const plannedModel = useMemo(
    () => buildPaneModel(split?.sections ?? null, panes.planned, false),
    [split, panes.planned],
  );

  /** Each bucket in words, and the keys that reach it. */
  const sectionInfo = useMemo<ReadonlyMap<string, SectionInfo>>(() => {
    const sections = split?.sections ?? [];
    const labels = sections.map((section) => subscopeLabel(section.ref));
    const keys = assignSubscopeKeys(labels);
    return new Map(sections.map((section, index) => [
      section.key,
      { label: labels[index] ?? "", keys: keys[index] ?? { digit: null, letter: null } },
    ]));
  }, [split, subscopeLabel]);

  /** Which bucket each key reaches — the same assignment the headings draw. */
  const sectionsByKey = useMemo(() => {
    const byKey = new Map<string, PlanSection>();
    for (const section of split?.sections ?? []) {
      const info = sectionInfo.get(section.key);
      if (info === undefined) continue;
      if (info.keys.digit !== null) byKey.set(String(info.keys.digit), section);
      if (info.keys.letter !== null) byKey.set(info.keys.letter, section);
    }
    return byKey;
  }, [split, sectionInfo]);

  // The keyboard walks what is drawn. With the split on, the planned pane's order is its sections'
  // order, which is not the triage's — so the flat array the selection moves through has to come
  // from the model rather than from `panes`, or Down would jump between buckets.
  const paneRowsOf = useCallback(
    (which: PlanPaneSide) => (which === "candidates" ? candidatesModel.rows : plannedModel.rows),
    [candidatesModel, plannedModel],
  );
  const paneRows = paneRowsOf(pane);
  const order = useMemo(() => paneRows.map((row) => row.node.id), [paneRows]);
  // A move empties rows out of the pane; an id left in the set would make the *next* gesture act on
  // work that is no longer in front of you. Pruning on the way out rather than in an effect keeps
  // the selection a function of what is drawn, with no frame where the two disagree.
  const live = useMemo(() => pruneSelection(selection, order), [selection, order]);
  const selectedIds = useMemo(() => selectedInOrder(live, order), [live, order]);

  const onNavigate = useCallback(
    (direction: 1 | -1, extend: boolean) => {
      setSelection((current) => navigateSelection(pruneSelection(current, order), order, direction, extend));
    },
    [order],
  );

  // Crossing to the other pane keeps your place in the list rather than starting over at the top:
  // the two panes are read side by side, and the row opposite the one you were on is the one you
  // were looking at. A selection belongs to one pane, so crossing leaves it behind.
  const onFocusPane = useCallback(
    (next: PlanPaneSide) => {
      if (next === pane) return;
      const current = live.leadId === null ? -1 : order.indexOf(live.leadId);
      const target = paneRowsOf(next);
      const landing = Math.min(Math.max(current, 0), target.length - 1);
      const id = target.length === 0 ? null : target[landing]?.node.id ?? null;
      setPane(next);
      setSelection(id === null ? EMPTY_PLAN_SELECTION : selectOnly(id));
    },
    [pane, live, order, paneRowsOf],
  );

  const onSelect = useCallback(
    (which: PlanPaneSide, id: string, modifiers: SelectModifiers) => {
      const rows = paneRowsOf(which).map((row) => row.node.id);
      setPane(which);
      setSelection((current) => {
        const base = which === pane ? pruneSelection(current, rows) : EMPTY_PLAN_SELECTION;
        if (modifiers.shift) return selectRange(base, rows, id);
        if (modifiers.ctrl) return toggleSelected(base, id);
        return selectOnly(id);
      });
    },
    [pane, paneRowsOf],
  );

  /**
   * What a gesture on `row` acts on: the whole selection when `row` is part of it, and `row` alone
   * otherwise. Clicking a card's own button while five are selected is the one case where "the
   * selection" and "the thing under the pointer" disagree, and the pointer wins — the button is
   * drawn on that card.
   */
  const batchFor = useCallback(
    (row: TaskListRow, which: PlanPaneSide): TaskListRow[] => {
      const rows = paneRowsOf(which);
      if (which !== pane || !live.ids.has(row.node.id)) return [row];
      const chosen = new Set(selectedIds);
      return rows.filter((candidate) => chosen.has(candidate.node.id));
    },
    [paneRowsOf, pane, live, selectedIds],
  );

  /** Puts the cursor on the first row still in the pane after `moved` left it. */
  const advancePast = useCallback(
    (which: PlanPaneSide, moved: readonly string[]) => {
      if (moved.length === 0) return;
      const rows = paneRowsOf(which).map((row) => row.node.id);
      const gone = new Set(moved);
      const last = rows.lastIndexOf(moved[moved.length - 1] ?? "");
      const after = rows.slice(last + 1).find((id) => !gone.has(id));
      const before = [...rows.slice(0, last)].reverse().find((id) => !gone.has(id));
      const landing = after ?? before ?? null;
      setSelection(landing === null ? EMPTY_PLAN_SELECTION : selectOnly(landing));
    },
    [paneRowsOf],
  );

  const moveAcross = useCallback(
    (rows: readonly TaskListRow[], from: PlanPaneSide) => {
      if (rows.length === 0) return;
      if (from === "candidates" && plannedModel.sectioned) {
        // With the pane split there is no "plan into this scope": the buckets are its parts, and
        // planning into the whole while looking at them is the move that filled a catch-all nobody
        // wanted. Said out loud rather than left as a key that does nothing.
        const head = rows[0];
        if (head !== undefined) showToast({ nodeId: head.node.id, message: t("planView:noParentPlan") });
        return;
      }
      const ids = rows.map((row) => row.node.id);
      void (from === "candidates" ? planInto(rows) : unplan(rows)).then((moved) => {
        // Only what actually moved advances the cursor. A refusal leaves the selection on the task
        // the toast is about, which is the one you are being told something about.
        advancePast(from, moved.length === ids.length ? ids : moved);
      });
    },
    [plannedModel.sectioned, planInto, unplan, advancePast, showToast, t],
  );

  const onMoveAcross = useCallback(
    (id: string) => {
      const row = paneRows.find((candidate) => candidate.node.id === id);
      if (row === undefined) return;
      moveAcross(batchFor(row, pane), pane);
    },
    [paneRows, moveAcross, batchFor, pane],
  );

  const planSelectionInto = useCallback(
    (section: PlanSection, rows: readonly TaskListRow[], from: PlanPaneSide) => {
      if (rows.length === 0) return;
      const label = sectionInfo.get(section.key)?.label ?? "";
      const ids = rows.map((row) => row.node.id);
      void planIntoSubscope(rows, section.ref, label, section.partial).then((moved) => {
        advancePast(from, moved.length === ids.length ? ids : moved);
      });
    },
    [sectionInfo, planIntoSubscope, advancePast],
  );

  const onPlanIntoSubscope = useCallback(
    (key: string) => {
      const section = sectionsByKey.get(key);
      if (section === undefined) return;
      const chosen = new Set(selectedIds);
      planSelectionInto(section, paneRows.filter((row) => chosen.has(row.node.id)), pane);
    },
    [sectionsByKey, selectedIds, paneRows, planSelectionInto, pane],
  );

  const onDragStart = useCallback(
    (which: PlanPaneSide) => (event: DragEvent<HTMLElement>, nodeId: string) => {
      const rows = paneRowsOf(which);
      const row = rows.find((candidate) => candidate.node.id === nodeId);
      if (row === undefined || event.dataTransfer === null) return;
      // Dragging a card that is not selected selects it first, so what is carried is always what is
      // lit: the pointer and the keyboard never end up talking about different rows.
      const batch = batchFor(row, which);
      if (batch.length === 1) {
        setPane(which);
        setSelection(selectOnly(nodeId));
      }
      writePlanDrag(event.dataTransfer, { pane: which, ids: batch.map((item) => item.node.id) });
    },
    [paneRowsOf, batchFor],
  );

  const onDrop = useCallback(
    (which: PlanPaneSide) => (event: DragEvent<HTMLElement>, section: PlanSection | null) => {
      const payload = readPlanDrag(event.dataTransfer);
      if (payload === null) return;
      event.preventDefault();
      const carried = new Set(payload.ids);
      const rows = paneRowsOf(payload.pane).filter((row) => carried.has(row.node.id));
      if (rows.length === 0) return;
      if (section !== null) {
        planSelectionInto(section, rows, payload.pane);
        return;
      }
      if (which === payload.pane) return;
      moveAcross(rows, payload.pane);
    },
    [paneRowsOf, planSelectionInto, moveAcross],
  );

  useKeyboardPlanView({
    isInputActive: isInputCaptured || editorModal !== null,
    pane,
    selectedTaskId: live.leadId,
    selectedTaskIds: selectedIds,
    onNavigate,
    onFocusPane,
    onMoveAcross,
    hasSubscopeKey: (key: string) => sectionsByKey.has(key),
    onPlanIntoSubscope,
    onStepScope: scope.step,
    onToggleBacklogCandidates: () => setShowBacklogged((on) => !on),
    onSetStatusMode: setStatusMode,
    onOpenEditor: onDoubleClick,
    onDeselect: () => setSelection(EMPTY_PLAN_SELECTION),
    onToggleFullscreen: toggleFullscreen,
    onUndo,
    onRedo,
  });

  const candidateOptions = useMemo<PaneOption[]>(() => [
    { id: "parentOnly", label: t("planView:optionParentOnly"), checked: parentOnly, onToggle: toggleParentOnly },
    { id: "groupByPath", label: t("planView:optionGroupByPath"), checked: groupByPath, onToggle: toggleGroupByPath },
  ], [t, parentOnly, toggleParentOnly, groupByPath, toggleGroupByPath]);

  const plannedOptions = useMemo<PaneOption[]>(() => [
    { id: "subscopeSplit", label: t("planView:optionSubscopeSplit"), checked: subscopeSplit, onToggle: toggleSubscopeSplit },
    { id: "premorning", label: t("planView:optionIncludePremorning"), checked: includePremorning, onToggle: toggleIncludePremorning },
  ], [t, subscopeSplit, toggleSubscopeSplit, includePremorning, toggleIncludePremorning]);

  const rootLabel = useMemo(() => {
    const frame = subtreeRootId === null ? tree : findNode(tree, subtreeRootId) ?? tree;
    return frame.title;
  }, [tree, subtreeRootId]);

  if (isLoading) return <div className={styles.centered}>{t("common:loading")}</div>;
  if (error !== null) return <div className={styles.centered}>{t("common:error", { message: error })}</div>;

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
          <PlanPane
            which="candidates"
            heading={t("planView:candidatesHeading")}
            options={candidateOptions}
            model={candidatesModel}
            focused={pane === "candidates"}
            grouped={groupByPath}
            rootLabel={rootLabel}
            selectedIds={live.ids}
            direction={plannedModel.sectioned ? null : "in"}
            sectionInfo={sectionInfo}
            empty={(
              <p className={styles.empty}>
                {t("planView:candidatesEmpty")}
                {parentOnly && <span className={styles.hint}>{t("planView:candidatesEmptyParentHint")}</span>}
                {!showBacklogged && <span className={styles.hint}>{t("planView:candidatesEmptyBacklogHint")}</span>}
              </p>
            )}
            onFocus={() => setPane("candidates")}
            onSelect={(id, modifiers) => onSelect("candidates", id, modifiers)}
            onMove={(row) => moveAcross(batchFor(row, "candidates"), "candidates")}
            onOpenEditor={onDoubleClick}
            onEnterSubtree={enterSubtree}
            onFilterByAntecedent={(id, side) => setPillSide("antecedent", id, side)}
            onDragStart={onDragStart("candidates")}
            onDrop={onDrop("candidates")}
          />
          <PlanPane
            which="planned"
            heading={t("planView:plannedHeading")}
            options={plannedOptions}
            model={plannedModel}
            focused={pane === "planned"}
            grouped={false}
            rootLabel={rootLabel}
            selectedIds={live.ids}
            direction="out"
            sectionInfo={sectionInfo}
            empty={<p className={styles.empty}>{t("planView:plannedEmpty")}</p>}
            onFocus={() => setPane("planned")}
            onSelect={(id, modifiers) => onSelect("planned", id, modifiers)}
            onMove={(row) => moveAcross(batchFor(row, "planned"), "planned")}
            onOpenEditor={onDoubleClick}
            onEnterSubtree={enterSubtree}
            onFilterByAntecedent={(id, side) => setPillSide("antecedent", id, side)}
            onDragStart={onDragStart("planned")}
            onDrop={onDrop("planned")}
          />
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
