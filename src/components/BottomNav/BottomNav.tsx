import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import type { View } from "@/stores/use-view-store";
import type { TouchLabelKey } from "@/stores/use-command-surface-store";
import styles from "./BottomNav.module.css";

/** The views in the order the bottom navigation draws them (`docs/spec/touch.md`). */
const NAV_ITEMS: ReadonlyArray<{ view: View; labelKey: TouchLabelKey; glyph: string }> = [
  { view: "zen", labelKey: "navZen", glyph: "◎" },
  { view: "list", labelKey: "navList", glyph: "☰" },
  { view: "plan", labelKey: "navPlan", glyph: "▦" },
  { view: "steps", labelKey: "navSteps", glyph: "⋮" },
  { view: "mindmap", labelKey: "navMap", glyph: "⑂" },
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
          <span className={styles.glyph} aria-hidden="true">{item.glyph}</span>
          {t(item.labelKey)}
        </button>
      ))}
    </nav>
  );
}
