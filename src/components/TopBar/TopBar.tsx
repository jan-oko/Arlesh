import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore, ALL_VIEWS, isView } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { LIST_PRESET_VALUES, isListPreset } from "@/utils/list-filter";
import type { ListPreset } from "@/utils/list-filter";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterChips from "@/components/FilterChips/FilterChips";
import Select from "@/components/Select/Select";
import Switch from "@/components/Switch/Switch";
import SubtreeBreadcrumb from "./SubtreeBreadcrumb";
import HabitCollapseSetting from "./HabitCollapseSetting";
import StepsZoomSetting from "./StepsZoomSetting";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";
/** Unblock only makes sense — and only appears as an option — while List View is active. */
const MINDMAP_PRESETS: readonly ListPreset[] = LIST_PRESET_VALUES.filter((p) => p !== "unblock");

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
  const mindmapOrientation = useViewStore((s) => s.mindmapOrientation);
  const toggleMindmapOrientation = useViewStore((s) => s.toggleMindmapOrientation);
  const pathHeaderIcons = useDisplayStore((s) => s.pathHeaderIcons);
  const togglePathHeaderIcons = useDisplayStore((s) => s.togglePathHeaderIcons);
  const asynchronousFirst = useDisplayStore((s) => s.asynchronousFirst);
  const planPathGrouping = useDisplayStore((s) => s.planPathGrouping);
  const togglePlanPathGrouping = useDisplayStore((s) => s.togglePlanPathGrouping);
  const planSubscopeSplit = useDisplayStore((s) => s.planSubscopeSplit);
  const togglePlanSubscopeSplit = useDisplayStore((s) => s.togglePlanSubscopeSplit);
  const toggleAsynchronousFirst = useDisplayStore((s) => s.toggleAsynchronousFirst);
  const listPreset = useListFilterStore((s) => s.filter.preset);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const closeToTray = useCloseToTrayStore((s) => s.closeToTray);
  const toggleCloseToTray = useCloseToTrayStore((s) => s.toggleCloseToTray);
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

  const activePreset: ListPreset = view === "list" && listPreset === "unblock" ? "unblock" : statusMode;
  const presetOptions = view === "list" ? LIST_PRESET_VALUES : MINDMAP_PRESETS;

  function selectPreset(value: string) {
    if (!isListPreset(value)) return;
    if (value === "unblock") {
      setListPreset("unblock");
      return;
    }
    setStatusMode(value);
    setListPreset(value);
  }

  return (
    <>
      <header className={styles.bar}>
        <div className={styles.side}>
          <div className={styles.anchor}>
            <button className={styles.iconBtn} type="button" aria-label={t("common:settings")} onClick={() => setSettingsOpen((o) => !o)}>{GEAR_ICON}</button>
            {settingsOpen && (
              <>
                <div className={styles.backdrop} onClick={() => setSettingsOpen(false)} />
                <div className={styles.popover}>
                  <div className={styles.settingRow}>
                    <Switch checked={theme === "light"} onChange={toggleTheme} label={t("common:lightMode")} />
                  </div>
                  {/* Neither view-specific nor tab-specific: what the window's close button does is
                      the same wherever you are, so it sits beside the theme, ungated. */}
                  <div className={styles.settingRow}>
                    <Switch checked={closeToTray} onChange={toggleCloseToTray} label={t("common:closeToTray")} />
                  </div>
                  {/* Branch axis only means something on the mindmap, so it stays out of List View. */}
                  {view === "mindmap" && (
                    <div className={styles.settingRow}>
                      <Switch
                        checked={mindmapOrientation === "vertical"}
                        onChange={toggleMindmapOrientation}
                        label={t("common:verticalLayout")}
                      />
                    </div>
                  )}
                  {/* Folded Habit history is drawn on the mindmap, so its threshold is gated to it. */}
                  {view === "mindmap" && <HabitCollapseSetting />}
                  {/* Card size is what a Step is drawn at, and what decides how many fit on a page,
                      so it is gated to Steps exactly as the branch axis is gated to the Mindmap. */}
                  {view === "steps" && <StepsZoomSetting />}
                  {/* Path headers exist only in List View, so their glyph switch is gated the same
                      way the branch axis is gated to the mindmap — a control for something the
                      current view cannot show is noise. */}
                  {view === "list" && (
                    <div className={styles.settingRow}>
                      <Switch
                        checked={pathHeaderIcons}
                        onChange={togglePathHeaderIcons}
                        label={t("common:pathIcons")}
                      />
                    </div>
                  )}
                  {/* Row order is a List View matter — the Mindmap's sibling order is set by hand
                      with Alt+arrows and is never rearranged for you — so the switch is gated to
                      the view it acts on, like the two above it. */}
                  {view === "list" && (
                    <div className={styles.settingRow}>
                      <Switch
                        checked={asynchronousFirst}
                        onChange={toggleAsynchronousFirst}
                        label={t("common:asynchronousFirst")}
                      />
                    </div>
                  )}
                  {/* Two switches, not one: where the work lives and when it is planned are
                      different questions, and a planning pass wants them in different
                      combinations. Gated to the Plan View like every switch above them. */}
                  {view === "plan" && (
                    <>
                      <div className={styles.settingRow}>
                        <Switch
                          checked={planPathGrouping}
                          onChange={togglePlanPathGrouping}
                          label={t("common:planPathGrouping")}
                        />
                      </div>
                      <div className={styles.settingRow}>
                        <Switch
                          checked={planSubscopeSplit}
                          onChange={togglePlanSubscopeSplit}
                          label={t("common:planSubscopeSplit")}
                        />
                      </div>
                    </>
                  )}
                  <div className={styles.settingRow}>
                    <button
                      className={styles.popoverBtn}
                      type="button"
                      onClick={() => { setSettingsOpen(false); toggleHotkeys(); }}
                    >
                      {t("common:keyboardShortcuts")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
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
