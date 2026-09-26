import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/**
 * The Plan View's two panes' switches, grouped by pane. App-wide.
 *
 * The same switches stay on each pane's ⋮ menu, beside the half they act on — that is where a
 * planning pass reaches for them mid-read. Here they sit with every other setting, so nothing the
 * app can be set to is missing from the one place that lists them all.
 */
export default function PlanPage() {
  const { t } = useTranslation(["planView", "settings"]);
  const groupByPath = useDisplayStore((s) => s.planCandidatesPathGrouping);
  const toggleGroupByPath = useDisplayStore((s) => s.togglePlanCandidatesPathGrouping);
  const parentOnly = useDisplayStore((s) => s.planCandidatesParentOnly);
  const toggleParentOnly = useDisplayStore((s) => s.togglePlanCandidatesParentOnly);
  const subscopeSplit = useDisplayStore((s) => s.planSplitBySubscope);
  const toggleSubscopeSplit = useDisplayStore((s) => s.togglePlanSplitBySubscope);
  const includePremorning = useDisplayStore((s) => s.planIncludePremorning);
  const toggleIncludePremorning = useDisplayStore((s) => s.togglePlanIncludePremorning);

  return (
    <div className={styles.page}>
      <h3 className={styles.heading}>{t("settings:planCandidates")}</h3>
      <Switch checked={parentOnly} onChange={toggleParentOnly} label={t("planView:optionParentOnly")} />
      <Switch checked={groupByPath} onChange={toggleGroupByPath} label={t("planView:optionGroupByPath")} />
      <h3 className={styles.heading}>{t("settings:planPlanned")}</h3>
      <Switch checked={subscopeSplit} onChange={toggleSubscopeSplit} label={t("planView:optionSubscopeSplit")} />
      <Switch checked={includePremorning} onChange={toggleIncludePremorning} label={t("planView:optionIncludePremorning")} />
      <p className={styles.note}>{t("settings:planPaneMenus")}</p>
    </div>
  );
}
