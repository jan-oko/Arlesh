import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { LIST_PRESET_VALUES, isListPreset } from "@/utils/list-filter";
import type { ListPreset } from "@/utils/list-filter";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterChips from "@/components/FilterChips/FilterChips";
import Select from "@/components/Select/Select";
import Switch from "@/components/Switch/Switch";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";
const ROOT_ICON = "↑";
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
  const { t, i18n } = useTranslation(["common", "listView"]);
  const isHebrew = i18n.resolvedLanguage === "he";
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const exitToRoot = useMindmapStore((s) => s.exitToRoot);
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
  const listPreset = useListFilterStore((s) => s.filter.preset);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const backArrow = i18n.dir() === "rtl" ? "→" : "←";
  // Unblock is List-View-only and doesn't touch the shared status mode — so its "active" state must
  // itself be gated on the current view, or a stale Unblock selection would leak into the Mindmap.
  const activePreset: ListPreset = view === "list" && listPreset === "unblock" ? "unblock" : statusMode;
  const presetOptions = view === "list" ? LIST_PRESET_VALUES : MINDMAP_PRESETS;

  function toggleLanguage() {
    void i18n.changeLanguage(isHebrew ? "en" : "he");
  }

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
                    <span>{t("common:language")}</span>
                    <button className={styles.langToggle} type="button" onClick={toggleLanguage}>
                      {isHebrew ? "English" : "עברית"}
                    </button>
                  </div>
                  <div className={styles.settingRow}>
                    <Switch checked={theme === "light"} onChange={toggleTheme} label={t("common:lightMode")} />
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
                </div>
              </>
            )}
          </div>
          <div className={styles.viewTabs}>
            <button
              type="button"
              className={`${styles.viewTab}${view === "mindmap" ? ` ${styles.viewTabActive}` : ""}`}
              onClick={() => setView("mindmap")}
            >
              {t("common:viewMindmap")}
            </button>
            <button
              type="button"
              className={`${styles.viewTab}${view === "list" ? ` ${styles.viewTabActive}` : ""}`}
              onClick={() => setView("list")}
            >
              {t("common:viewList")}
            </button>
          </div>
          <Select
            value={activePreset}
            options={presetOptions.map((preset) => ({ value: preset, label: t(`listView:preset.${preset}`) }))}
            onChange={selectPreset}
            ariaLabel={t("listView:statusPresetLabel")}
          />
          {subtreeRootId !== null && subtreeNav !== null && (
            <>
              {subtreeNav.parentSubtreeId !== null && (
                <button className={styles.pill} type="button" onClick={exitToRoot}>
                  <span aria-hidden="true">{ROOT_ICON}</span>{subtreeNav.rootTitle}
                </button>
              )}
              <button className={styles.pill} type="button" onClick={() => exitSubtree(subtreeNav.parentSubtreeId)}>
                <span aria-hidden="true">{backArrow}</span>{subtreeNav.parentTitle}
              </button>
            </>
          )}
        </div>

        <div className={styles.side}>
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
