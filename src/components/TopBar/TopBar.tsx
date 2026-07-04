import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { isFilterActive } from "@/utils/filter-tree";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import styles from "./TopBar.module.css";

const GEAR_ICON = "⚙";
const ROOT_ICON = "↑";

/** A small funnel (filter) glyph for the Filter button. */
function FunnelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

export default function TopBar() {
  const { t, i18n } = useTranslation("common");
  const isHebrew = i18n.resolvedLanguage === "he";
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const exitToRoot = useMindmapStore((s) => s.exitToRoot);
  const filter = useFilterStore((s) => s.filter);
  // Popover-open state lives in the store so the Alt+F keyboard shortcut can toggle it too.
  const filterOpen = useFilterStore((s) => s.popoverOpen);
  const setFilterPopover = useFilterStore((s) => s.setFilterPopover);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const backArrow = i18n.dir() === "rtl" ? "→" : "←";
  const active = isFilterActive(filter);

  function toggleLanguage() {
    void i18n.changeLanguage(isHebrew ? "en" : "he");
  }

  return (
    <header className={styles.bar}>
      <div className={styles.side}>
        <div className={styles.anchor}>
          <button className={styles.iconBtn} type="button" aria-label={t("settings")} onClick={() => setSettingsOpen((o) => !o)}>{GEAR_ICON}</button>
          {settingsOpen && (
            <>
              <div className={styles.backdrop} onClick={() => setSettingsOpen(false)} />
              <div className={styles.popover}>
                <div className={styles.settingRow}>
                  <span>{t("language")}</span>
                  <button className={styles.langToggle} type="button" onClick={toggleLanguage}>
                    {isHebrew ? "English" : "עברית"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
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
          <button
            className={`${styles.filterBtn}${active ? ` ${styles.filterActive}` : ""}`}
            type="button"
            onClick={toggleFilterPopover}
          >
            <FunnelIcon />{t("filter")}{active && <span className={styles.badge} />}
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
  );
}
