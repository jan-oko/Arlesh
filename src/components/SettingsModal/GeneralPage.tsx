import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/use-theme-store";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import HabitCollapseSetting from "./HabitCollapseSetting";
import styles from "./SettingsModal.module.css";

interface Props {
  /** Closes the settings and opens the keyboard cheat-sheet in their place. */
  onOpenHotkeys: () => void;
}

/** Appearance, how the Plan preset's scope matches, whether Start hides a wait that has checks,
 * whether Start and Do show Started tasks, how
 * much Habit history the Mindmap and the Steps View fold, whether the node searches offer archived
 * nodes, and the way to the keyboard cheat-sheet. App-wide. */
export default function GeneralPage({ onOpenHotkeys }: Props) {
  const { t } = useTranslation("common");
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const planScopeOverlapping = useDisplayStore((s) => s.planScopeOverlapping);
  const togglePlanScopeOverlapping = useDisplayStore((s) => s.togglePlanScopeOverlapping);
  const startHidesCheckedWaits = useDisplayStore((s) => s.startHidesCheckedWaits);
  const toggleStartHidesCheckedWaits = useDisplayStore((s) => s.toggleStartHidesCheckedWaits);
  const startShowsStarted = useDisplayStore((s) => s.startShowsStarted);
  const toggleStartShowsStarted = useDisplayStore((s) => s.toggleStartShowsStarted);
  const doShowsStarted = useDisplayStore((s) => s.doShowsStarted);
  const toggleDoShowsStarted = useDisplayStore((s) => s.toggleDoShowsStarted);
  const searchIncludesArchived = useDisplayStore((s) => s.searchIncludesArchived);
  const toggleSearchIncludesArchived = useDisplayStore((s) => s.toggleSearchIncludesArchived);

  return (
    <div className={styles.page}>
      <Switch checked={theme === "light"} onChange={toggleTheme} label={t("lightMode")} />
      <Switch checked={planScopeOverlapping} onChange={togglePlanScopeOverlapping} label={t("planScopeOverlapping")} />
      <Switch
        checked={startHidesCheckedWaits}
        onChange={toggleStartHidesCheckedWaits}
        label={t("startHidesCheckedWaits")}
      />
      <Switch checked={startShowsStarted} onChange={toggleStartShowsStarted} label={t("startShowsStarted")} />
      <Switch checked={doShowsStarted} onChange={toggleDoShowsStarted} label={t("doShowsStarted")} />
      <Switch
        checked={searchIncludesArchived}
        onChange={toggleSearchIncludesArchived}
        label={t("searchIncludesArchived")}
      />
      <HabitCollapseSetting />
      <div>
        <button className={styles.button} type="button" onClick={onOpenHotkeys}>
          {t("keyboardShortcuts")}
        </button>
      </div>
    </div>
  );
}
