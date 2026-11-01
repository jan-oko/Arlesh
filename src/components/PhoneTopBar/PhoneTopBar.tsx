import { useState } from "react";
import { useTranslation } from "react-i18next";
import AgentStatus from "@/components/TopBar/AgentStatus";
import SubtreeBreadcrumb from "@/components/TopBar/SubtreeBreadcrumb";
import FilterChips from "@/components/FilterChips/FilterChips";
import FilterPopover from "@/components/FilterPopover/FilterPopover";
import FilterSearchModal from "@/components/FilterSearchModal/FilterSearchModal";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import { useFilterStore } from "@/stores/use-filter-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import { usePresetChoice } from "@/hooks/use-preset-choice";
import { lockedStatusMode } from "@/utils/view-preset";
import PresetSheet from "./PresetSheet";
import PhoneMenuSheet from "./PhoneMenuSheet";
import styles from "./PhoneTopBar.module.css";

/** The ☰ menu button's glyph; its accessible name is the translated "Menu". */
const MENU_GLYPH = "☰";
/** The chip's dropdown chevron. */
const CHEVRON_GLYPH = "▾";

type OpenSheet = "menu" | "preset" | "settings" | null;

/**
 * The phone layout's top bar (`docs/spec/touch.md`): the ☰ menu, the title — the view at the
 * board's root, the breadcrumb inside a subtree — the preset chip, the agents' status. The
 * filter chips follow it, as they follow the desktop bar.
 */
export default function PhoneTopBar() {
  const { t } = useTranslation(["touch", "common", "listView"]);
  const view = useViewStore((s) => s.view);
  const inSubtree = useMindmapStore((s) => s.subtreeNav !== null);
  const filterOpen = useFilterStore((s) => s.popoverOpen);
  const setFilterPopover = useFilterStore((s) => s.setFilterPopover);
  const filterSearchOpen = useFilterStore((s) => s.searchOpen);
  const setFilterSearch = useFilterStore((s) => s.setFilterSearch);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const choice = usePresetChoice();
  const [sheet, setSheet] = useState<OpenSheet>(null);

  const viewTitles: Record<View, string> = {
    mindmap: t("common:viewMindmap"),
    list: t("common:viewList"),
    plan: t("common:viewPlan"),
    steps: t("common:viewSteps"),
    zen: t("common:viewZen"),
  };
  const presetLabel = t(`listView:preset.${choice.active}`);

  return (
    <>
      <header className={styles.bar}>
        <button type="button" className={styles.iconBtn} aria-label={t("touch:menuOpen")} aria-haspopup="dialog" onClick={() => setSheet("menu")}>
          {MENU_GLYPH}
        </button>
        <div className={styles.title}>
          {inSubtree ? <SubtreeBreadcrumb /> : <h1 className={styles.viewName}>{viewTitles[view]}</h1>}
        </div>
        <button
          type="button"
          className={styles.chip}
          aria-haspopup="dialog"
          aria-label={t("touch:presetChipLabel", { preset: presetLabel })}
          onClick={() => setSheet("preset")}
        >
          {presetLabel} {CHEVRON_GLYPH}
        </button>
        <AgentStatus />
      </header>
      <FilterChips />
      {sheet === "menu" && (
        <PhoneMenuSheet
          showPlanScope={lockedStatusMode(view) === null && choice.active === "plan"}
          onOpenSettings={() => setSheet("settings")}
          onClose={() => setSheet((current) => (current === "menu" ? null : current))}
        />
      )}
      {sheet === "preset" && <PresetSheet choice={choice} onClose={() => setSheet(null)} />}
      {sheet === "settings" && (
        <SettingsModal onClose={() => setSheet(null)} onOpenHotkeys={() => { setSheet(null); toggleHotkeys(); }} />
      )}
      {filterOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setFilterPopover(false)} />
          <FilterPopover />
        </>
      )}
      {filterSearchOpen && <FilterSearchModal onClose={() => setFilterSearch(false)} />}
    </>
  );
}
