import { useTranslation } from "react-i18next";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import PlanScopeField from "@/components/ScopePicker/PlanScopeField";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { TOUCH_ONLY_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { usePaletteStore } from "@/stores/use-palette-store";
import styles from "./PhoneTopBar.module.css";

interface Props {
  /** Whether the Plan preset's scope belongs in the menu: Plan is chosen, in a view that does not lock it. */
  showPlanScope: boolean;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** The ☰ menu: what the desktop top bar holds beyond the view and the preset. */
export default function PhoneMenuSheet({ showPlanScope, onOpenSettings, onClose }: Props) {
  const { t } = useTranslation(["touch", "filter"]);
  const setFilterPopover = useFilterStore((s) => s.setFilterPopover);
  const planScope = useFilterStore((s) => s.filter.planScope);
  const setPlanScope = useFilterStore((s) => s.setPlanScope);
  const planScopeOverlapping = useDisplayStore((s) => s.planScopeOverlapping);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const openPalette = usePaletteStore((s) => s.open);
  // On a touch-only device the sheet this opens teaches the gestures, so the entry says so.
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);

  function then(action: () => void) {
    return () => { onClose(); action(); };
  }

  return (
    <BottomSheet title={t("touch:menuTitle")} onClose={onClose}>
      <ul className={styles.sheetList}>
        <li><button type="button" className={styles.sheetRow} onClick={then(() => setFilterPopover(true))}>{t("touch:menuFilter")}</button></li>
        {showPlanScope && (
          <li className={styles.sheetField}>
            <span>{t("touch:menuPlanScope")}</span>
            <PlanScopeField
              value={planScope}
              onChange={setPlanScope}
              hint={planScopeOverlapping ? t("filter:planScopeHintOverlapping") : t("filter:planScopeHint")}
            />
          </li>
        )}
        <li><button type="button" className={styles.sheetRow} onClick={then(openPalette)}>{t("touch:menuPalette")}</button></li>
        <li><button type="button" className={styles.sheetRow} onClick={then(onOpenSettings)}>{t("touch:menuSettings")}</button></li>
        <li><button type="button" className={styles.sheetRow} onClick={then(toggleHotkeys)}>{touchOnly ? t("touch:gesturesTitle") : t("touch:menuHotkeys")}</button></li>
      </ul>
    </BottomSheet>
  );
}
