import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import type { TouchLabelKey } from "@/stores/use-command-surface-store";
import ActionIcon, { type ActionIconName } from "@/components/ActionIcon/ActionIcon";
import styles from "./BottomNav.module.css";

/** The views in the order the bottom navigation draws them (`docs/spec/touch.md`). */
const NAV_ITEMS: ReadonlyArray<{ view: View; labelKey: TouchLabelKey; icon: ActionIconName }> = [
  { view: "zen", labelKey: "navZen", icon: "viewZen" },
  { view: "list", labelKey: "navList", icon: "viewList" },
  { view: "plan", labelKey: "navPlan", icon: "viewPlan" },
  { view: "steps", labelKey: "navSteps", icon: "viewSteps" },
  { view: "mindmap", labelKey: "navMap", icon: "viewMap" },
];

/** The phone layout's view switcher, in place of the top bar's dropdown. */
export default function BottomNav() {
  const { t } = useTranslation("touch");
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  return (
    <nav className={styles.nav} aria-label={t("bottomNavLabel")}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`${styles.item} ${item.view === view ? styles.current : ""}`}
          aria-current={item.view === view ? "page" : undefined}
          onClick={() => setView(item.view)}
        >
          <span className={styles.glyph}><ActionIcon name={item.icon} size={22} /></span>
          {t(item.labelKey)}
        </button>
      ))}
    </nav>
  );
}
