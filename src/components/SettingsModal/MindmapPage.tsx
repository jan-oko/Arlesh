import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import Switch from "@/components/Switch/Switch";
import HabitCollapseSetting from "./HabitCollapseSetting";
import styles from "./SettingsModal.module.css";

/** How the Mindmap draws: its branch axis (per tab) and how much Habit history it folds (app-wide). */
export default function MindmapPage() {
  const { t } = useTranslation("common");
  const orientation = useViewStore((s) => s.mindmapOrientation);
  const toggleOrientation = useViewStore((s) => s.toggleMindmapOrientation);

  return (
    <div className={styles.page}>
      <Switch checked={orientation === "vertical"} onChange={toggleOrientation} label={t("verticalLayout")} />
      <HabitCollapseSetting />
    </div>
  );
}
