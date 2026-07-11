import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import {
  TASK_STATUS_VALUES, GOAL_STATUS_VALUES, PROJECT_STATUS_VALUES, SCOPE_STATE_VALUES, BLOCKED_VALUES,
} from "@/utils/list-filter";
import type { PillDimension } from "@/utils/list-filter";
import type { ArchivedMode } from "@/utils/filter-tree";
import Switch from "@/components/Switch/Switch";
import PillFilterSection from "./PillFilterSection";
import { EntityAdder, FixedValueAdder } from "./PillAdders";
import styles from "./FilterPopover.module.css";

function archivedPillClass(mode: ArchivedMode): string {
  if (mode === "include") return `${styles.archivedPill} ${styles.archivedPillInclude}`;
  if (mode === "exclude") return `${styles.archivedPill} ${styles.archivedPillExclude}`;
  return `${styles.archivedPill}`;
}

/** The filter panel opened from the top-bar Filter button — a pure "add a filter" chooser (active
 * filters render as chips in the TopBar). Status preset lives in the TopBar too. Grouped into a few
 * always-expanded clusters rather than one long list. */
export default function FilterPopover() {
  const { t } = useTranslation(["filter", "nodeKinds", "listView"]);
  const filter = useFilterStore((s) => s.filter);
  const toggleModeFlows = useFilterStore((s) => s.toggleModeFlows);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const toggleShowInfo = useFilterStore((s) => s.toggleShowInfo);
  const toggleShowFlow = useFilterStore((s) => s.toggleShowFlow);
  const toggleWorkMode = useFilterStore((s) => s.toggleWorkMode);
  const cycleArchivedMode = useFilterStore((s) => s.cycleArchivedMode);
  const reset = useFilterStore((s) => s.reset);

  const view = useViewStore((s) => s.view);
  const listFilter = useListFilterStore((s) => s.filter);
  const addPill = useListFilterStore((s) => s.addPill);
  const listReset = useListFilterStore((s) => s.reset);

  const display = useFilterDisplay();

  const selectedTagIds = useMemo(() => new Set(filter.tagFilters.map((tf) => tf.tagId)), [filter.tagFilters]);
  const availableTags = useMemo(
    () => display.tagOptions
      .filter((tag) => !selectedTagIds.has(tag.id))
      .map((tag) => ({ id: String(tag.id), label: tag.label, color: tag.color })),
    [display.tagOptions, selectedTagIds],
  );

  const showFlowsSub = filter.statusMode === "plan" || filter.statusMode === "start";

  function addedSet(dimension: PillDimension): ReadonlySet<string> {
    return new Set(listFilter.pills[dimension].map((p) => p.value));
  }
  function availableEntities(dimension: PillDimension, pool: typeof display.parentPool) {
    const added = addedSet(dimension);
    return pool.filter((option) => !added.has(option.id));
  }

  return (
    <div className={styles.popover}>
      <div className={styles.cluster}>
        <div className={styles.clusterLabel}>{t("tagTypeClusterLabel")}</div>
        <PillFilterSection label={t("tagsLabel")}>
          {availableTags.length > 0 && (
            <EntityAdder
              placeholder={t("addTag")}
              available={availableTags}
              onAdd={(id) => addTagFilter(parseInt(id, 10))}
            />
          )}
        </PillFilterSection>

        {view === "mindmap" && (
          <PillFilterSection label={t("typesLabel")}>
            <div className={styles.typePills}>
              <button type="button" className={`${styles.typePill}${filter.showInfo ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowInfo}>
                {t("nodeKinds:info")}
              </button>
              <button type="button" className={`${styles.typePill}${filter.showFlow ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowFlow}>
                {t("nodeKinds:flow")}
              </button>
            </div>
            {showFlowsSub && (
              <Switch checked={filter.modeIncludeFlows} onChange={toggleModeFlows} label={t("includeFlows")} />
            )}
          </PillFilterSection>
        )}

        <PillFilterSection label={t("workLabel")}>
          <Switch checked={filter.workMode} onChange={toggleWorkMode} label={t("workMode")} />
        </PillFilterSection>
      </div>

      {view === "mindmap" && (
        <div className={styles.cluster}>
          <div className={styles.clusterLabel}>{t("statusClusterLabel")}</div>
          <PillFilterSection label={t("archivedLabel")}>
            <button
              type="button"
              className={archivedPillClass(filter.archivedMode)}
              onClick={cycleArchivedMode}
              title={t(`archivedTooltip.${filter.archivedMode}`)}
            >
              {t("archivedPill")}
            </button>
          </PillFilterSection>
        </div>
      )}

      {view === "list" && (() => {
        const parentCandidates = availableEntities("parent", display.parentPool);
        const antecedentCandidates = availableEntities("antecedent", display.parentPool);
        const dependencyCandidates = availableEntities("dependency", display.dependencyPool);
        return (
          <div className={styles.cluster}>
            <div className={styles.clusterLabel}>{t("listView:hierarchyClusterLabel")}</div>
            <PillFilterSection label={t("listView:parentLabel")}>
              {parentCandidates.length > 0 && (
                <EntityAdder placeholder={t("listView:addParent")} available={parentCandidates} onAdd={(id) => addPill("parent", id)} />
              )}
            </PillFilterSection>
            <PillFilterSection label={t("listView:antecedentLabel")}>
              {antecedentCandidates.length > 0 && (
                <EntityAdder placeholder={t("listView:addAntecedent")} available={antecedentCandidates} onAdd={(id) => addPill("antecedent", id)} />
              )}
            </PillFilterSection>
            <PillFilterSection label={t("listView:dependencyLabel")}>
              {dependencyCandidates.length > 0 && (
                <EntityAdder placeholder={t("listView:addDependency")} available={dependencyCandidates} onAdd={(id) => addPill("dependency", id)} />
              )}
            </PillFilterSection>
          </div>
        );
      })()}

      {view === "list" && (
        <div className={styles.cluster}>
          <div className={styles.clusterLabel}>{t("listView:statusScopeClusterLabel")}</div>
          <PillFilterSection label={t("listView:taskStatusLabel")}>
            <FixedValueAdder values={TASK_STATUS_VALUES} added={addedSet("taskStatus")} labelFor={display.displayTaskStatus} onAdd={(v) => addPill("taskStatus", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:goalStatusLabel")}>
            <FixedValueAdder values={GOAL_STATUS_VALUES} added={addedSet("goalStatus")} labelFor={display.displayGoalStatus} onAdd={(v) => addPill("goalStatus", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:projectStatusLabel")}>
            <FixedValueAdder values={PROJECT_STATUS_VALUES} added={addedSet("projectStatus")} labelFor={display.displayProjectStatus} onAdd={(v) => addPill("projectStatus", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:scopeStateLabel")}>
            <FixedValueAdder values={SCOPE_STATE_VALUES} added={addedSet("scopeState")} labelFor={display.displayScopeState} onAdd={(v) => addPill("scopeState", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:blockedLabel")}>
            <FixedValueAdder values={BLOCKED_VALUES} added={addedSet("blocked")} labelFor={display.displayBlocked} onAdd={(v) => addPill("blocked", v)} />
          </PillFilterSection>
        </div>
      )}

      <button
        type="button"
        className={styles.reset}
        onClick={() => { reset(); if (view === "list") listReset(); }}
      >
        {t("reset")}
      </button>
    </div>
  );
}
