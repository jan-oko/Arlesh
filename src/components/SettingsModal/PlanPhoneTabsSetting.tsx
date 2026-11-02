import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import HelpTip from "./HelpTip";
import styles from "./PlanPhoneTabsSetting.module.css";

/**
 * How the phone's split planned pane shows its buckets: one at a time under tabs (on), or all
 * stacked under their headings (off). App-wide, and for the phone layout only.
 */
export default function PlanPhoneTabsSetting() {
  const { t } = useTranslation("planView");
  const tabs = useDisplayStore((s) => s.planPhoneTabs);
  const toggle = useDisplayStore((s) => s.togglePlanPhoneTabs);

  return (
    <div className={styles.row}>
      <Switch checked={tabs} onChange={toggle} label={t("optionPhoneTabs")} />
      <HelpTip text={t("optionPhoneTabsHelp")} label={t("optionPhoneTabsHelpLabel")} />
    </div>
  );
}
