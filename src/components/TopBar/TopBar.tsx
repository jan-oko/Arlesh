import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore, ALL_VIEWS, isView } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { LIST_PRESET_VALUES, isListOnlyPreset, isListPreset } from "@/utils/list-filter";
import type { ListPreset } from "@/utils/list-filter";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterChips from "@/components/FilterChips/FilterChips";
import Select from "@/components/Select/Select";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import SubtreeBreadcrumb from "./SubtreeBreadcrumb";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";
/** Unblock only makes sense — and only appears as an option — while List View is active. */
const MINDMAP_PRESETS: readonly ListPreset[] = LIST_PRESET_VALUES.filter((p) => !isListOnlyPreset(p));

/** A small funnel (filter) glyph for the Filter button. */
function FunnelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

export default function TopBar() {
  const { t } = useTranslation(["common", "listView"]);
  const statusMode = useFilterStore((s) => s.filter.statusMode);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  // Popover-open state lives in the store so the Alt+F keyboard shortcut can toggle it too.
  const filterOpen = useFilterStore((s) => s.popoverOpen);
  const setFilterPopover = useFilterStore((s) => s.setFilterPopover);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  const listPreset = useListFilterStore((s) => s.filter.preset);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Unblock is List-View-only and doesn't touch the shared status mode — so its "active" state must
  // itself be gated on the current view, or a stale Unblock selection would leak into the Mindmap.
  const viewLabels: Record<View, string> = {
    mindmap: t("common:viewMindmap"),
    list: t("common:viewList"),
    plan: t("common:viewPlan"),
    steps: t("common:viewSteps"),
  };

  const activePreset: ListPreset = view === "list" && isListOnlyPreset(listPreset) ? listPreset : statusMode;
  const presetOptions = view === "list" ? LIST_PRESET_VALUES : MINDMAP_PRESETS;

  function selectPreset(value: string) {
    if (!isListPreset(value)) return;
    if (value === "unblock" || value === "expectations") {
      setListPreset(value);
      return;
    }
    setStatusMode(value);
    setListPreset(value);
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
            value={activePreset}
            options={presetOptions.map((preset) => ({ value: preset, label: t(`listView:preset.${preset}`) }))}
            onChange={selectPreset}
            ariaLabel={t("listView:statusPresetLabel")}
          />
        </div>

        {/* Where you are, and the whole way down to it. A slot rather than a sibling, because the
            breadcrumb draws nothing at the true root and the cell has to hold its place anyway —
            otherwise the Filter button would slide into the middle of the bar. */}
        <div className={styles.center}>
          <SubtreeBreadcrumb />
        </div>

        <div className={`${styles.side} ${styles.sideEnd}`}>
          <div className={styles.anchor}>
            <button className={styles.filterBtn} type="button" onClick={toggleFilterPopover}>
              <FunnelIcon />{t("common:filter")}
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
    </>
  );
}
