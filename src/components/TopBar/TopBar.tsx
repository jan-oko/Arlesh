import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useViewStore, ALL_VIEWS, isView } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { usePresetChoice } from "@/hooks/use-preset-choice";
import { useFilterDot } from "@/hooks/use-filter-dot";
import { isListPreset } from "@/utils/list-filter";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterChips from "@/components/FilterChips/FilterChips";
import FilterSearchModal from "@/components/FilterSearchModal/FilterSearchModal";
import Select from "@/components/Select/Select";
import PlanScopeField from "@/components/ScopePicker/PlanScopeField";
import { useDisplayStore } from "@/stores/use-display-store";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import SubtreeBreadcrumb from "./SubtreeBreadcrumb";
import AgentStatus from "./AgentStatus";
import ModeIndicator from "./ModeIndicator";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";

/** A small funnel (filter) glyph for the Filter button. */
function FunnelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

export default function TopBar() {
  const { t } = useTranslation(["common", "listView", "planView", "zenView", "filter"]);
  const planScope = useFilterStore((s) => s.filter.planScope);
  const setPlanScope = useFilterStore((s) => s.setPlanScope);
  const planScopeOverlapping = useDisplayStore((s) => s.planScopeOverlapping);
  // Popover-open state lives in the store so the Alt+F keyboard shortcut can toggle it too.
  const filterOpen = useFilterStore((s) => s.popoverOpen);
  const setFilterPopover = useFilterStore((s) => s.setFilterPopover);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  const filterSearchOpen = useFilterStore((s) => s.searchOpen);
  const setFilterSearch = useFilterStore((s) => s.setFilterSearch);
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filterDot = useFilterDot();

  // Unblock is List-View-only and doesn't touch the shared status mode — so its "active" state must
  // itself be gated on the current view, or a stale Unblock selection would leak into the Mindmap.
  const viewLabels: Record<View, string> = {
    mindmap: t("common:viewMindmap"),
    list: t("common:viewList"),
    plan: t("common:viewPlan"),
    steps: t("common:viewSteps"),
    zen: t("common:viewZen"),
  };

  // The preset control's rules — which presets the view offers, which it reads under, the Plan and
  // Zen Views' locks and what choosing one writes — are `usePresetChoice`'s, shared with the phone
  // layout's preset chip, so the two controls cannot disagree.
  const presets = usePresetChoice();
  const presetLockedReason = presets.lockedReason ?? undefined;
  // The Plan preset's scope sits beside the preset it belongs to, and only while it is the one
  // chosen. Never in a view with a preset of its own: the Plan View reads under Plan with a scope
  // of its own, and the Zen View never reads under Plan at all.
  const showPlanScope = presets.lockedReason === null && presets.active === "plan";

  function selectPreset(value: string) {
    if (isListPreset(value)) presets.select(value);
  }

  return (
    <>
      <header className={styles.bar}>
        <div className={styles.side}>
          {/* The gear opens every setting the app has, organised into pages. It replaced a popover
              whose switches came and went with the active view — see SettingsModal. */}
          <button
            className={styles.iconBtn}
            type="button"
            aria-label={t("common:settings")}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            {GEAR_ICON}
          </button>
          {settingsOpen && (
            <SettingsModal
              onClose={() => setSettingsOpen(false)}
              onOpenHotkeys={() => { setSettingsOpen(false); toggleHotkeys(); }}
            />
          )}
          {/* A dropdown rather than a row of tabs. Four views already crowded the bar, and a row
              that grows with every view is a bar that shrinks with every view — where a dropdown
              costs the same width at four as at ten. It is the app's own `Select`, the one beside
              it, so the bar has one dropdown affordance rather than a second invented for this;
              the kebab menus arriving in the Plan View are a different control for a different
              question (several independent toggles, not one choice among some). Options come from
              the one list of views, so a fifth is a union member and nothing else. */}
          <Select
            value={view}
            options={ALL_VIEWS.map((candidate) => ({ value: candidate, label: viewLabels[candidate] }))}
            onChange={(next) => { if (isView(next)) setView(next); }}
            ariaLabel={t("common:viewSelectorLabel")}
          />
          <Select
            value={presets.active}
            options={presets.options.map((preset) => ({
              value: preset,
              label: t(`listView:preset.${preset}`),
              ...(presetLockedReason !== undefined && preset !== presets.active ? { disabled: true, title: presetLockedReason } : {}),
            }))}
            onChange={selectPreset}
            ariaLabel={t("listView:statusPresetLabel")}
            {...(presetLockedReason === undefined ? {} : { title: presetLockedReason })}
          />
          {showPlanScope && (
            <PlanScopeField
              value={planScope}
              onChange={setPlanScope}
              hint={planScopeOverlapping ? t("filter:planScopeHintOverlapping") : t("filter:planScopeHint")}
            />
          )}
        </div>

        {/* Where you are, and the whole way down to it. A slot rather than a sibling, because the
            breadcrumb draws nothing at the true root and the cell has to hold its place anyway —
            otherwise the Filter button would slide into the middle of the bar. */}
        <div className={styles.center}>
          <SubtreeBreadcrumb />
        </div>

        <div className={`${styles.side} ${styles.sideEnd}`}>
          {/* The agents' status: drawn only while something applies — the capacity lock, a pending
              agentic wait, or Agentic work In Progress. */}
          <AgentStatus />
          {/* Where the board lives — this device or a server — and whether the server answers. */}
          <ModeIndicator />
          <div className={styles.anchor}>
            {/* The dot says the menu holds a setting nothing outside it shows — a pill the chips
                do not draw, or Archived / Backlog off "as the preset says". */}
            <button
              className={styles.filterBtn}
              type="button"
              aria-expanded={filterOpen}
              title={filterDot ? t("filter:filterButtonTitleUndrawn") : t("filter:filterButtonTitle")}
              {...(filterDot ? { "aria-label": t("filter:filterButtonUndrawnLabel") } : {})}
              onClick={toggleFilterPopover}
            >
              <FunnelIcon />{t("common:filter")}
              {filterDot && <span className={styles.filterDot} aria-hidden="true" />}
            </button>
            {filterOpen && (
              <>
                <div className={styles.backdrop} onClick={() => setFilterPopover(false)} />
                <FilterPopover />
              </>
            )}
          </div>
        </div>
      </header>
      <FilterChips />
      {filterSearchOpen && <FilterSearchModal onClose={() => setFilterSearch(false)} />}
    </>
  );
}
