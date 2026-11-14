import { useRef, useState } from "react";
import { useCutoutClearance } from "@/hooks/use-cutout-clearance";
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
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePresetChoice } from "@/hooks/use-preset-choice";
import { lockedStatusMode } from "@/utils/view-preset";
import PresetSheet from "./PresetSheet";
import PhoneMenuSheet from "./PhoneMenuSheet";
import TopBarSquare from "./TopBarSquare";
import styles from "./PhoneTopBar.module.css";

/** The ☰ menu button's glyph; its accessible name is the translated "Menu". */
const MENU_GLYPH = "☰";
/** The phone held upright: the breadcrumb gives way to `‹ {current node}`. */
const PORTRAIT_QUERY = "(orientation: portrait)";
/** The chip's dropdown chevron. */
const CHEVRON_GLYPH = "▾";

type OpenSheet = "menu" | "preset" | "settings" | null;

/**
 * The phone layout's top bar (`docs/spec/touch.md`): the ☰ menu, the title — the app's name at the
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
  const portrait = useMediaQuery(PORTRAIT_QUERY);
  const choice = usePresetChoice();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const barRef = useRef<HTMLElement>(null);
  useCutoutClearance(barRef);

  const presetLabel = t(`listView:preset.${choice.active}`);

  return (
    <>
      <header ref={barRef} className={styles.bar}>
        <button type="button" className={styles.iconBtn} aria-label={t("touch:menuOpen")} aria-haspopup="dialog" onClick={() => setSheet("menu")}>
          {MENU_GLYPH}
        </button>
        <div className={styles.title}>
          {inSubtree ? <SubtreeBreadcrumb compact={portrait} /> : <h1 className={styles.viewName}>{t("common:appName")}</h1>}
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
        <TopBarSquare />
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
