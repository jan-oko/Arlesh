import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** How the Mindmap draws: its branch axis, per tab. How much Habit history folds is on General,
 * since the Steps View folds it too. */
export default function MindmapPage() {
  const { t } = useTranslation("common");
  const orientation = useViewStore((s) => s.mindmapOrientation);
  const toggleOrientation = useViewStore((s) => s.toggleMindmapOrientation);

  return (
    <div className={styles.page}>
      <Switch checked={orientation === "vertical"} onChange={toggleOrientation} label={t("verticalLayout")} />
    </div>
  );
}
