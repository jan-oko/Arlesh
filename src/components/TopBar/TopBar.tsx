import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { LIST_PRESET_VALUES, isListPreset } from "@/utils/list-filter";
import type { ListPreset } from "@/utils/list-filter";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterChips from "@/components/FilterChips/FilterChips";
import Select from "@/components/Select/Select";
import Switch from "@/components/Switch/Switch";
import HabitCollapseSetting from "./HabitCollapseSetting";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";
const ROOT_ICON = "↑";
const BACK_ICON = "←";
/** Unblock only makes sense — and only appears as an option — while List View is active. */
const MINDMAP_PRESETS: readonly ListPreset[] = LIST_PRESET_VALUES.filter((p) => p !== "unblock");

/** A subtree glyph — a parent branching down to two children — for the "you are here" indicator. */
function SubtreeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="2" y="17" width="6" height="5" rx="1" />
      <rect x="16" y="17" width="6" height="5" rx="1" />
      <path d="M12 7v4M5 17v-2h14v2" />
    </svg>
  );
}

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
  const pathHeaderIcons = useDisplayStore((s) => s.pathHeaderIcons);
  const togglePathHeaderIcons = useDisplayStore((s) => s.togglePathHeaderIcons);
  const listPreset = useListFilterStore((s) => s.filter.preset);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Unblock is List-View-only and doesn't touch the shared status mode — so its "active" state must
  // itself be gated on the current view, or a stale Unblock selection would leak into the Mindmap.
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
                <span aria-hidden="true">{BACK_ICON}</span>{subtreeNav.parentTitle}
              </button>
            </>
          )}
        </div>

        {/* Where you are — centred in the bar, and unadorned. It is not a control and not a way
            out (its neighbours on the left are), so it carries no pill, border or background:
            the glyph and the title alone say which subtree you are inside. The label is spelled
            out for a screen reader, which would otherwise hear a third bare title. */}
        <div className={styles.center}>
          {subtreeRootId !== null && subtreeNav !== null && (
            <span className={styles.current}>
              <SubtreeIcon />
              <span className={styles.srOnly}>{t("common:insideSubtree")}</span>
              {subtreeNav.currentTitle}
            </span>
          )}
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
