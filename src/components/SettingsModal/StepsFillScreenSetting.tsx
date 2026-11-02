import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import HelpTip from "./HelpTip";
import styles from "./StepsFillScreenSetting.module.css";

/**
 * How the phone's Steps View lays its cards out: paged, filling the screen's height (on), or one
 * scrolling column (off). App-wide, and for the phone layout only; the desktop grid ignores it.
 */
export default function StepsFillScreenSetting() {
  const { t } = useTranslation("stepsView");
  const fillsScreen = useDisplayStore((s) => s.stepsFillScreen);
  const toggle = useDisplayStore((s) => s.toggleStepsFillScreen);

  return (
    <div className={styles.row}>
      <Switch checked={fillsScreen} onChange={toggle} label={t("fillScreen")} />
      <HelpTip text={t("fillScreenHelp")} label={t("fillScreenHelpLabel")} />
    </div>
  );
}
