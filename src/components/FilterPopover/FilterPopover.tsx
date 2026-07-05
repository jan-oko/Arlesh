import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listDomains, DOMAIN_SUBTYPE } from "@/api/domains";
import type { Domain } from "@/api/domains";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import type { StatusMode, TagFilterMode } from "@/utils/filter-tree";
import type { PillDimension } from "@/utils/list-filter";
import {
  TASK_STATUS_VALUES, GOAL_STATUS_VALUES, PROJECT_STATUS_VALUES, SCOPE_STATE_VALUES, BLOCKED_VALUES,
  isTaskStatusValue, isGoalStatusValue, isProjectStatusValue, isScopeStateValue, isBlockedValue,
} from "@/utils/list-filter";
import Switch from "@/components/Switch/Switch";
import PillFilterSection from "./PillFilterSection";
import { EntityAdder, FixedValueAdder } from "./PillAdders";
import styles from "./FilterPopover.module.css";

const STATUS_MODES: StatusMode[] = ["all", "plan", "start", "do"];
const CHEVRON_OPEN = "▾";
const CHEVRON_CLOSED = "▸";
const NEXT_TAG_MODE: Record<TagFilterMode, TagFilterMode> = { any: "all", all: "exclude", exclude: "any" };
/** Node kinds a Task/Goal/Project can be parented under — the pool for the Parent/Antecedent pickers. */
const PARENT_KINDS = new Set(["aspect", "domain", "project", "goal", "task"]);
/** Set-theory glyphs: Any = union, All = intersection, Exclude = empty set. */
const MODE_SYMBOL: Record<TagFilterMode, string> = { any: "∪", all: "∩", exclude: "∅" };

/** Faded background from a #rrggbb aspect colour (ignored for other formats). */
function fade(color: string | null): string | undefined {
  return color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}22` : undefined;
}

/** Searchable, portalled tag picker that adds a tag filter on select (so it isn't clipped by the popover). */
function TagAdder({ available, colorOf, onAdd }: { available: Domain[]; colorOf: (id: number) => string | null; onAdd: (id: number) => void }) {
  const { t } = useTranslation("filter");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: r.width });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = available.filter((tag) => tag.title.toLowerCase().includes(q)).slice(0, 30);

  return (
    <div className={styles.searchWrap}>
      <input
        ref={inputRef}
        type="text"
        className={styles.search}
        placeholder={t("addTag")}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && results.length > 0 && pos !== null && createPortal(
        <div className={styles.menu} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>
          {results.map((tag) => {
            const color = colorOf(tag.id);
            return (
              <div key={tag.id} className={styles.menuItem} onMouseDown={(e) => { e.preventDefault(); onAdd(tag.id); setQuery(""); }}>
                {color !== null && <span className={styles.dot} style={{ background: color }} />}
                {tag.title}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** The filter panel opened from the top-bar Filter button: status preset, tag filters, type toggles,
 * plus (while List View is active) the List-View-exclusive filter dimensions. */
export default function FilterPopover() {
  const { t } = useTranslation(["filter", "nodeKinds", "status", "listView"]);
  const filter = useFilterStore((s) => s.filter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleModeFlows = useFilterStore((s) => s.toggleModeFlows);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setTagFilterMode = useFilterStore((s) => s.setTagFilterMode);
  const removeTagFilter = useFilterStore((s) => s.removeTagFilter);
  const toggleShowInfo = useFilterStore((s) => s.toggleShowInfo);
  const toggleShowFlow = useFilterStore((s) => s.toggleShowFlow);
  const toggleWorkMode = useFilterStore((s) => s.toggleWorkMode);
  const reset = useFilterStore((s) => s.reset);

  const view = useViewStore((s) => s.view);
  const listFilter = useListFilterStore((s) => s.filter);
  const addPill = useListFilterStore((s) => s.addPill);
  const setPillMode = useListFilterStore((s) => s.setPillMode);
  const removePill = useListFilterStore((s) => s.removePill);
  const listReset = useListFilterStore((s) => s.reset);

  // Load all domains so each tag's *aspect* colour can be resolved by walking up to the nearest coloured ancestor.
  // Advanced (tags + type visibility) collapses; open by default only when something advanced is set.
  const advancedActive = filter.tagFilters.length > 0 || !filter.showInfo || !filter.showFlow || filter.workMode;
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);

  const [domains, setDomains] = useState<Domain[]>([]);
  useEffect(() => { void listDomains().then(setDomains); }, []);
  const byId = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const tags = useMemo(() => domains.filter((d) => d.subtype === DOMAIN_SUBTYPE.TAG), [domains]);

  const tagName = (id: number) => tags.find((tag) => tag.id === id)?.title ?? `#${id}`;
  const colorOf = (id: number): string | null => {
    const seen = new Set<number>();
    let cur = byId.get(id);
    while (cur !== undefined && !seen.has(cur.id)) {
      if (cur.color !== null) return cur.color;
      seen.add(cur.id);
      cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined;
    }
    return null;
  };
  const selected = useMemo(() => new Set(filter.tagFilters.map((tf) => tf.tagId)), [filter.tagFilters]);
  const available = tags.filter((tag) => tag.title.trim() !== "" && !selected.has(tag.id));
  const showFlowsSub = filter.statusMode === "plan" || filter.statusMode === "start";

  // List-View-exclusive filters need a searchable pool of nodes (for parent/antecedent/dependency) —
  // only fetched while List View is active, since Mindmap never renders these sections.
  const { tree } = useMindmapData();
  const searchableNodes = useMemo(() => (view === "list" ? collectSearchableNodes(tree) : []), [view, tree]);
  const nodeLabel = useMemo(() => new Map(searchableNodes.map((n) => [n.id, n.title])), [searchableNodes]);
  const parentPool = useMemo(
    () => searchableNodes.filter((n) => PARENT_KINDS.has(n.kind)).map((n) => ({ id: n.id, label: n.title })),
    [searchableNodes],
  );
  const dependencyPool = useMemo(
    () => searchableNodes.filter((n) => n.kind === "task" || n.kind === "goal").map((n) => ({ id: n.id, label: n.title })),
    [searchableNodes],
  );

  function displayNodeRef(value: string): string {
    return nodeLabel.get(value) ?? value;
  }
  function displayTaskStatus(value: string): string {
    return isTaskStatusValue(value) ? t(`status:task.${value}`) : value;
  }
  function displayGoalStatus(value: string): string {
    return isGoalStatusValue(value) ? t(`status:goal.${value}`) : value;
  }
  function displayProjectStatus(value: string): string {
    return isProjectStatusValue(value) ? t(`status:project.${value}`) : value;
  }
  function displayScopeState(value: string): string {
    return isScopeStateValue(value) ? t(`listView:scopeState.${value}`) : value;
  }
  function displayBlocked(value: string): string {
    return isBlockedValue(value) ? t(`listView:blockedState.${value}`) : value;
  }
  function addedSet(dimension: PillDimension): ReadonlySet<string> {
    return new Set(listFilter.pills[dimension].map((p) => p.value));
  }

  return (
    <div className={styles.popover}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("statusLabel")}</div>
        <div className={styles.segmented}>
          {STATUS_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.seg}${filter.statusMode === mode ? ` ${styles.segActive}` : ""}`}
              onClick={() => setStatusMode(mode)}
            >
              {t(`mode.${mode}`)}
            </button>
          ))}
        </div>
        {showFlowsSub && (
          <Switch checked={filter.modeIncludeFlows} onChange={toggleModeFlows} label={t("includeFlows")} />
        )}
      </section>

      <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedOpen((o) => !o)}>
        <span aria-hidden="true">{advancedOpen ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>{t("advanced")}
      </button>

      {advancedOpen && <>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("tagsLabel")}</div>
        {filter.tagFilters.length > 0 && (
          <div className={styles.tagPills}>
            {filter.tagFilters.map((tf) => {
              const color = colorOf(tf.tagId);
              return (
                <span key={tf.tagId} className={styles.tagPill} style={{ borderColor: color ?? undefined, background: fade(color) }}>
                  <button
                    type="button"
                    className={`${styles.modeGlyph} ${styles[`mode_${tf.mode}`]}`}
                    title={t(`tagMode.${tf.mode}`)}
                    aria-label={t(`tagMode.${tf.mode}`)}
                    onClick={() => setTagFilterMode(tf.tagId, NEXT_TAG_MODE[tf.mode])}
                  >
                    {MODE_SYMBOL[tf.mode]}
                  </button>
                  <span className={styles.tagPillName}>{tagName(tf.tagId)}</span>
                  <button type="button" className={styles.tagPillX} aria-label={t("removeTagFilter")} onClick={() => removeTagFilter(tf.tagId)}>×</button>
                </span>
              );
            })}
          </div>
        )}
        {available.length > 0 && <TagAdder available={available} colorOf={colorOf} onAdd={addTagFilter} />}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("typesLabel")}</div>
        <div className={styles.typePills}>
          <button type="button" className={`${styles.typePill}${filter.showInfo ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowInfo}>
            {t("nodeKinds:info")}
          </button>
          <button type="button" className={`${styles.typePill}${filter.showFlow ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowFlow}>
            {t("nodeKinds:flow")}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("workLabel")}</div>
        <Switch checked={filter.workMode} onChange={toggleWorkMode} label={t("workMode")} />
      </section>

      {view === "list" && <>
        <PillFilterSection
          label={t("listView:parentLabel")}
          pills={listFilter.pills.parent}
          displayName={displayNodeRef}
          onSetMode={(value, mode) => setPillMode("parent", value, mode)}
          onRemove={(value) => removePill("parent", value)}
          addControl={<EntityAdder placeholder={t("listView:addParent")} available={parentPool} onAdd={(id) => addPill("parent", id)} />}
        />
        <PillFilterSection
          label={t("listView:antecedentLabel")}
          pills={listFilter.pills.antecedent}
          displayName={displayNodeRef}
          onSetMode={(value, mode) => setPillMode("antecedent", value, mode)}
          onRemove={(value) => removePill("antecedent", value)}
          addControl={<EntityAdder placeholder={t("listView:addAntecedent")} available={parentPool} onAdd={(id) => addPill("antecedent", id)} />}
        />
        <PillFilterSection
          label={t("listView:dependencyLabel")}
          pills={listFilter.pills.dependency}
          displayName={displayNodeRef}
          onSetMode={(value, mode) => setPillMode("dependency", value, mode)}
          onRemove={(value) => removePill("dependency", value)}
          addControl={<EntityAdder placeholder={t("listView:addDependency")} available={dependencyPool} onAdd={(id) => addPill("dependency", id)} />}
        />
        <PillFilterSection
          label={t("listView:taskStatusLabel")}
          pills={listFilter.pills.taskStatus}
          displayName={displayTaskStatus}
          onSetMode={(value, mode) => setPillMode("taskStatus", value, mode)}
          onRemove={(value) => removePill("taskStatus", value)}
          addControl={
            <FixedValueAdder values={TASK_STATUS_VALUES} added={addedSet("taskStatus")} labelFor={displayTaskStatus} onAdd={(v) => addPill("taskStatus", v)} />
          }
        />
        <PillFilterSection
          label={t("listView:goalStatusLabel")}
          pills={listFilter.pills.goalStatus}
          displayName={displayGoalStatus}
          onSetMode={(value, mode) => setPillMode("goalStatus", value, mode)}
          onRemove={(value) => removePill("goalStatus", value)}
          addControl={
            <FixedValueAdder values={GOAL_STATUS_VALUES} added={addedSet("goalStatus")} labelFor={displayGoalStatus} onAdd={(v) => addPill("goalStatus", v)} />
          }
        />
        <PillFilterSection
          label={t("listView:projectStatusLabel")}
          pills={listFilter.pills.projectStatus}
          displayName={displayProjectStatus}
          onSetMode={(value, mode) => setPillMode("projectStatus", value, mode)}
          onRemove={(value) => removePill("projectStatus", value)}
          addControl={
            <FixedValueAdder values={PROJECT_STATUS_VALUES} added={addedSet("projectStatus")} labelFor={displayProjectStatus} onAdd={(v) => addPill("projectStatus", v)} />
          }
        />
        <PillFilterSection
          label={t("listView:scopeStateLabel")}
          pills={listFilter.pills.scopeState}
          displayName={displayScopeState}
          onSetMode={(value, mode) => setPillMode("scopeState", value, mode)}
          onRemove={(value) => removePill("scopeState", value)}
          addControl={
            <FixedValueAdder values={SCOPE_STATE_VALUES} added={addedSet("scopeState")} labelFor={displayScopeState} onAdd={(v) => addPill("scopeState", v)} />
          }
        />
        <PillFilterSection
          label={t("listView:blockedLabel")}
          pills={listFilter.pills.blocked}
          displayName={displayBlocked}
          onSetMode={(value, mode) => setPillMode("blocked", value, mode)}
          onRemove={(value) => removePill("blocked", value)}
          addControl={
            <FixedValueAdder values={BLOCKED_VALUES} added={addedSet("blocked")} labelFor={displayBlocked} onAdd={(v) => addPill("blocked", v)} />
          }
        />
      </>}

      <button
        type="button"
        className={styles.reset}
        onClick={() => { reset(); if (view === "list") listReset(); }}
      >
        {t("reset")}
      </button>
      </>}
    </div>
  );
}
