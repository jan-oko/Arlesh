import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import {
  TASK_STATUS_VALUES, GOAL_STATUS_VALUES, PROJECT_STATUS_VALUES, VERDICT_FILTER_VALUES,
  SCOPE_STATE_VALUES, BLOCKED_VALUES, AGENTIC_VALUES, ASYNCHRONOUS_VALUES,
} from "@/utils/list-filter";
import type { PillDimension } from "@/utils/list-filter";
import type { OverrideMode } from "@/utils/filter-tree";
import Switch from "@/components/Switch/Switch";
import PillFilterSection from "./PillFilterSection";
import { EntityAdder, FixedValueAdder } from "./PillAdders";
import styles from "./FilterPopover.module.css";

const CHEVRON_OPEN = "▾";
const CHEVRON_CLOSED = "▸";

/** The tri-state pill's classes for a given mode. Shared by Archived and Backlog, which cycle and
 * read identically — only what they select differs. */
function overridePillClass(mode: OverrideMode): string {
  if (mode === "include") return `${styles.overridePill} ${styles.overridePillInclude}`;
  if (mode === "exclude") return `${styles.overridePill} ${styles.overridePillExclude}`;
  return `${styles.overridePill}`;
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
  const togglePrivateMode = useFilterStore((s) => s.togglePrivateMode);
  const cycleArchivedMode = useFilterStore((s) => s.cycleArchivedMode);
  const cycleBacklogMode = useFilterStore((s) => s.cycleBacklogMode);
  const reset = useFilterStore((s) => s.reset);
  // Collapsed by default; auto-opens when either Advanced filter is already engaged, so an active
  // filter is never hidden behind an unopened disclosure.
  const [advancedOpen, setAdvancedOpen] = useState(
    filter.archivedMode !== "inactive" || filter.backlogMode !== "inactive",
  );

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
  function availableEntities(dimension: PillDimension, pool: typeof display.antecedentPool) {
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

        <PillFilterSection label={t("privateLabel")}>
          <Switch checked={filter.privateMode} onChange={togglePrivateMode} label={t("privateMode")} />
        </PillFilterSection>
      </div>

      {view === "mindmap" && (
        <div className={styles.cluster}>
          <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedOpen((o) => !o)}>
            <span aria-hidden="true">{advancedOpen ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>
            {t("advanced")}
          </button>
          {advancedOpen && (
            <div className={styles.advancedBody}>
              <PillFilterSection label={t("archivedLabel")}>
                <button
                  type="button"
                  className={overridePillClass(filter.archivedMode)}
                  onClick={cycleArchivedMode}
                  title={t(`archivedTooltip.${filter.archivedMode}`)}
                >
                  {t("archivedPill")}
                </button>
              </PillFilterSection>
              <PillFilterSection label={t("backlogLabel")}>
                <button
                  type="button"
                  className={overridePillClass(filter.backlogMode)}
                  onClick={cycleBacklogMode}
                  title={t(`backlogTooltip.${filter.backlogMode}`)}
                >
                  {t("backlogPill")}
                </button>
              </PillFilterSection>
            </div>
          )}
        </div>
      )}

      {view === "list" && (() => {
        const antecedentCandidates = availableEntities("antecedent", display.antecedentPool);
        const dependencyCandidates = availableEntities("dependency", display.dependencyPool);
        return (
          <div className={styles.cluster}>
            <div className={styles.clusterLabel}>{t("listView:hierarchyClusterLabel")}</div>
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
          <PillFilterSection label={t("listView:verdictLabel")}>
            <FixedValueAdder values={VERDICT_FILTER_VALUES} added={addedSet("verdict")} labelFor={display.displayVerdict} onAdd={(v) => addPill("verdict", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:scopeStateLabel")}>
            <FixedValueAdder values={SCOPE_STATE_VALUES} added={addedSet("scopeState")} labelFor={display.displayScopeState} onAdd={(v) => addPill("scopeState", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:blockedLabel")}>
            <FixedValueAdder values={BLOCKED_VALUES} added={addedSet("blocked")} labelFor={display.displayBlocked} onAdd={(v) => addPill("blocked", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:agenticLabel")}>
            <FixedValueAdder values={AGENTIC_VALUES} added={addedSet("agentic")} labelFor={display.displayAgentic} onAdd={(v) => addPill("agentic", v)} />
          </PillFilterSection>
          <PillFilterSection label={t("listView:asynchronousLabel")}>
            <FixedValueAdder values={ASYNCHRONOUS_VALUES} added={addedSet("asynchronous")} labelFor={display.displayAsynchronous} onAdd={(v) => addPill("asynchronous", v)} />
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
